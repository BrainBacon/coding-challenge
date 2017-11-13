let { root } = require('begin-build/props');
let KDTree = require('kd-tree-javascript/kdTree').kdTree;
/* eslint-disable */
let axios = require('axios');
let tripsUrl = require('file-loader?name=resources/trips.json!../../docs/resources/trips.json');
/* eslint-enable */
let gradient = require('./gradient');
let style = require('./map');

const GRID_SIZE = 30;
const SIG_FIG = 1;

module.exports = {
  data: () => ({
    available: false,
    loading: false,
    maxSpeed: 0,
    ready: false,
  }),

  created() {
    axios.defaults.baseURL = root;
    this.mapsReady = new Promise(resolve => {
      window.initMap = () => resolve(window.google.maps);
      if (window.mapsReady) {
        resolve(window.google.maps);
      }
    });
  },

  methods: {
    toLatLng(obj) {
      if (obj instanceof this.maps.LatLng) {
        return obj;
      }
      return new this.maps.LatLng(obj.lat, obj.lng);
    },

    getNode(node) {
      let bounds = new this.maps.LatLngBounds();
      bounds.extend(this.toLatLng(node));
      return {
        lat: node.lat,
        lng: node.lng,
        speed: node.speed,
        sum: node.speed,
        count: 1,
        bounds,
      };
    },

    bindChild(parent, child) {
      if (!child) {
        return null;
      }
      if (parent) {
        parent.sum += child.sum;
        parent.count += child.count;
        parent.bounds.union(child.bounds);
      }
      return child;
    },

    distance(a, b) {
      if (!b) {
        b = a.getSouthWest();
        a = a.getNorthEast();
      } else {
        a = this.toLatLng(a);
        b = this.toLatLng(b);
      }
      return this.maps.geometry.spherical.computeDistanceBetween(a, b);
    },

    getTree(node) {
      if (!node) {
        return null;
      }
      let { obj, left, right } = node;
      this.maxSpeed = Math.max(obj.speed, this.maxSpeed);
      node = this.getNode(obj);
      node.left = this.bindChild(node, this.getTree(left));
      node.right = this.bindChild(node, this.getTree(right));
      node.resolution = this.distance(node.bounds);
      return node;
    },

    initTree(coords) {
      let kd = new KDTree(coords, (a, b) => this.distance(a, b), ['lat', 'lng']);
      this.tree = this.getTree(kd.root);
    },

    clearMarkers() {
      if (this.markers) {
        this.markers.forEach(marker => marker.setMap(null));
      }
      this.markers = [];
    },

    copyNode(node) {
      if (!node) {
        return null;
      }
      let out = this.getNode(node);
      out.bounds.union(node.bounds);
      out.sum = node.sum;
      out.count = node.count;
      return out;
    },

    groupChild(parent, child, resolution) {
      if (!child) {
        return null;
      }
      if (child.resolution > resolution) {
        return this.bindChild(parent, this.traverse(child, resolution));
      }
      return this.bindChild(parent, this.copyNode(child));
    },

    traverse(node, resolution) {
      if (!node.bounds.intersects(this.map.getBounds())) {
        return null;
      }
      let out = this.groupChild(null, node.left, resolution);
      out = this.groupChild(out, node.right, resolution);
      if (this.map.getBounds().contains(this.toLatLng(node))) {
        out = this.bindChild(this.getNode(node), out);
      }
      if (!out) {
        return null;
      }
      if (out.sum < (10 ** -SIG_FIG)) {
        out.count = 0;
      }
      /* eslint-disable */
      for (let other of this.nodes) {
        /* eslint-enable */
        if (this.distance(other.bounds.getCenter(), out) < resolution) {
          other.sum += out.sum;
          other.count += out.count;
          return null;
        }
      }
      this.nodes.push(out);
      return null;
    },

    getMarkers(projection) {
      if (!this.ready) {
        return;
      }
      this.clearMarkers();
      this.nodes = [];
      let ne = this.map.getBounds().getNorthEast();
      let pixel = projection.fromLatLngToDivPixel(ne);
      pixel.x -= GRID_SIZE;
      pixel.y += GRID_SIZE;
      this.traverse(this.tree, this.distance(ne, projection.fromDivPixelToLatLng(pixel)));
      this.nodes.forEach(node => {
        let avg = node.sum / node.count;
        let scale = gradient.length * (avg / this.maxSpeed);
        this.markers.push(new this.maps.Marker({
          map: this.map,
          position: node.bounds.getCenter(),
          icon: {
            path: 'M160 0 a 160 160 0 1 0 160 160 L 320 0 Z',
            rotation: 135,
            scale: (44 / 390),
            fillColor: gradient[~~Math.min(scale, gradient.length - 1)],
            fillOpacity: 1,
            strokeColor: 'black',
            strokeWeight: 2,
            labelOrigin: { x: 160, y: 160 },
          },
          label: {
            fontSize: '12px',
            text: `${avg.toFixed(SIG_FIG)}`,
          },
        }));
      });
    },

    initMap() {
      if (!this.map) {
        this.map = new this.maps.Map(this.$refs.map, {
          center: this.tree.bounds.getCenter(),
          zoom: 13,
          minZoom: 5,
          mapTypeControlOptions: { mapTypeIds: ['styled_map'] },
          disableDefaultUI: true,
        });
        this.map.mapTypes.set('styled_map', new this.maps.StyledMapType(style));
        this.map.setMapTypeId('styled_map');
      }
      this.overlay = new this.maps.OverlayView();
      let proj;
      this.overlay.draw = () => {
        proj = this.overlay.getProjection();
      };
      this.overlay.setMap(this.map);
      this.map.addListener('bounds_changed', () => this.getMarkers(proj));
      this.map.fitBounds(this.tree.bounds);
    },

    async prepare(groups) {
      let coords = groups.reduce((arr, trip) => arr.concat(trip.coords), []);
      this.maps = await this.mapsReady;
      this.initTree(coords);
      this.loading = false;
      this.ready = true;
      this.initMap();
    },

    async submit() {
      this.loading = true;
      let res = await Promise.all(Array.from(this.$refs.input.files).map(async file => {
        let reader = new FileReader();
        let ready = new Promise(resolve => {
          reader.onload = ({ target: { result } }) => {
            resolve(JSON.parse(result));
          };
        });
        reader.readAsText(file);
        return ready;
      }));
      this.prepare(res);
    },

    async sample() {
      this.loading = true;
      let { data } = await axios.get(tripsUrl);
      this.prepare(Object.values(data));
    },

    reset() {
      this.$refs.form.reset();
      this.overlay.setMap(null);
      this.maps.event.clearListeners(this.map, 'bounds_changed');
      delete this.tree;
      delete this.nodes;
      delete this.overlay;
      this.clearMarkers();
      Object.assign(this.$data, this.$options.data.apply(this));
    },
  },

  beforeDestroy() {
    this.reset();
  },
};

