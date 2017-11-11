let { kdTree } = require('kd-tree-javascript/kdTree.js');
let { root } = require('begin-build/props');
/* eslint-disable */
let axios = require('axios');
let tripsUrl = require('file-loader?name=resources/trips.json!../../docs/resources/trips.json');
/* eslint-enable */
let gradient = require('./gradient');
let style = require('./map');
let pin = require('./pin.svg');

const GRID_SIZE = 150;

module.exports = {
  data: () => ({
    extremes: { speed: 0, lat: [90, -90], lng: [180, -180] },
    ready: false,
    available: false,
    loading: false,
  }),

  created() {
    axios.defaults.baseURL = root;
    this.mapsReady = new Promise(resolve => {
      window.initMap = () => resolve(window.google.maps);
      if (window.mapsReady) {
        resolve(window.google.maps);
      }
    });
    this.styles = gradient.map(color => ({
      url: `data:image/svg+xml,${encodeURIComponent(pin.replace(/{{fill}}/g, color))}`,
      scaledSize: {
        width: 64,
        height: 78,
      },
      size: {
        width: 64,
        height: 78,
      },
    }));
  },

  methods: {
    distance(a, b) {
      return this.maps.geometry.spherical.computeDistanceBetween(a, b);
    },

    kdDistance(a, b) {
      return this.distance(new this.maps.LatLng(a.lat, a.lng), new this.maps.LatLng(b.lat, b.lng));
    },

    bound(parent, child) {
      if (child) {
        parent.bounds.union(child.bounds);
        parent.avg += child.avg;
        parent.avg /= 2;
      }
    },

    getTree(node) {
      if (!node) {
        return null;
      }
      let { obj, left, right } = node;
      obj.left = this.getTree(left);
      obj.right = this.getTree(right);
      obj.bounds = new this.maps.LatLngBounds();
      obj.bounds.extend(obj);
      obj.avg = obj.speed;
      this.bound(obj, obj.left);
      this.bound(obj, obj.right);
      obj.resolution = this.distance(obj.bounds.getNorthEast(), obj.bounds.getSouthWest());
      return obj;
    },

    surrounds(node, bounds) {
      return bounds.contains(node.bounds.getNorthEast())
        && bounds.contains(node.bounds.getSouthWest());
    },

    getStyle(avg) {
      let i = ~~Math.min(this.styles.length * (avg / this.extremes.speed), this.styles.length - 1);
      return this.styles[i];
    },

    traverse(map, node, resolution, bounds) {
      if (!node) {
        return;
      }
      if (bounds) {
        if (!node.bounds.intersects(map.getBounds())) {
          return;
        }
        if (this.surrounds(node, bounds)) {
          this.traverse(map, node, resolution);
          return;
        }
      }
      if (node.resolution < resolution) {
        this.markers.push(new this.maps.Marker({
          map,
          position: new this.maps.LatLng(node.lat, node.lng),
          label: `${node.avg.toFixed(1)}`,
          icon: this.getStyle(node.avg),
        }));
        return;
      }
      this.traverse(map, node.left, resolution, bounds);
      this.traverse(map, node.right, resolution, bounds);
    },

    getMarkers(map) {
      if (this.markers) {
        this.markers.forEach(marker => marker.setMap(null));
      }
      this.markers = [];
      let bounds = map.getBounds();
      let scale = 2 ** map.getZoom();
      let ne = bounds.getNorthEast();
      let projection = map.getProjection();
      let point = projection.fromLatLngToPoint(ne);
      let normalize = n => ((n * scale) - GRID_SIZE) / scale;
      let sw = new this.maps.Point(normalize(point.x), normalize(point.y));
      let resolution = this.distance(ne, projection.fromPointToLatLng(sw));
      this.traverse(map, this.tree, resolution, bounds);
    },

    async prepare(groups) {
      let coords = groups.reduce((arr, trip) => arr.concat(trip.coords), []);
      coords = coords.map(({ lat, lng, speed }) => { // dist, index
        this.extremes.speed = Math.max(speed, this.extremes.speed);
        this.extremes.lat[0] = Math.min(lat, this.extremes.lat[0]);
        this.extremes.lat[1] = Math.max(lat, this.extremes.lat[1]);
        this.extremes.lng[0] = Math.min(lng, this.extremes.lng[0]);
        this.extremes.lng[1] = Math.max(lng, this.extremes.lng[1]);
        return { lat, lng, speed };
      });
      this.maps = await this.mapsReady;
      let bounds = new this.maps.LatLngBounds();
      bounds.extend(new this.maps.LatLng(this.extremes.lat[0], this.extremes.lng[0]));
      bounds.extend(new this.maps.LatLng(this.extremes.lat[1], this.extremes.lng[1]));
      /* eslint-disable new-cap */
      let kd = new kdTree(coords, (...args) => this.kdDistance(...args), ['lat', 'lng']);
      /* eslint-enable new-cap */
      let center = bounds.getCenter();
      kd.nearest(center, 1);
      this.tree = this.getTree(kd.root);
      this.loading = false;
      this.ready = true;
      let map = new this.maps.Map(this.$refs.map, {
        center,
        zoom: 13,
        draggable: false,
        minZoom: 5,
        mapTypeControlOptions: { mapTypeIds: ['styled_map'] },
        disableDefaultUI: true,
      });
      map.mapTypes.set('styled_map', new this.maps.StyledMapType(style));
      map.setMapTypeId('styled_map');
      map.fitBounds(bounds);
      this.boundsListener = map.addListener('bounds_changed', () => this.getMarkers(map));
    },

    async submit() {
      this.available = false;
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
      this.available = false;
      this.loading = true;
      let { data } = await axios.get(tripsUrl);
      this.prepare([{ coords: data }]);
    },

    reset() {
      this.$refs.form.reset();
      this.maps.event.removeListener(this.boundsListener);
      delete this.maps;
      delete this.tree;
      delete this.markers;
      Object.assign(this.$data, this.$options.data.apply(this));
    },
  },

  beforeDestroy() {
    this.reset();
  },
};

