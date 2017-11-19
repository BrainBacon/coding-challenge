axios = require('axios')
axios.defaults.baseURL = require('begin-build/props').root
KDTree = require('kd-tree-javascript/kdTree').kdTree
tripsUrl = require('file-loader?name=resources/trips.json!../../docs/resources/trips.json')
gradient = require('./gradient')
style = require('./map')

GRID_SIZE = 30
SIG_FIG = 1

class component:

  @classmethod
  def data(self):
    return {
      'available': False,
      'loading': False,
      'maxSpeed': 0,
      'ready': False,
    }

  @classmethod
  def created(self):
    def promise(resolve):
      def initMap():
        resolve(window.google.maps)
      window.initMap = initMap
      if window.mapsReady:
        resolve(window.google.maps)
    self.mapsReady = new(Promise(promise))

  def toLatLng(self, obj):
    if isinstance(obj, self.maps.LatLng):
      return obj
    return new(self.maps.LatLng(obj.lat, obj.lng))

  def getNode(self, node):
    bounds = new(self.maps.LatLngBounds())
    bounds.extend(self.toLatLng(node))
    return {
      'lat': node.lat,
      'lng': node.lng,
      'speed': node.speed,
      'sum': node.speed,
      'count': 1,
      'bounds': bounds,
    }

  def bindChild(self, parent, child):
    if not child:
      return None
    if parent:
      parent.sum += child.sum
      parent.count += child.count
      parent.bounds.union(child.bounds)
    return child

  def distance(self, a, b):
    if not b:
      b = a.getSouthWest()
      a = a.getNorthEast()
    else:
      a = self.toLatLng(a)
      b = self.toLatLng(b)
    return self.maps.geometry.spherical.computeDistanceBetween(a, b)

  def getTree(self, node):
    if not node:
      return None
    obj = node.obj
    left = node.left
    right = node.right
    self.maxSpeed = Math.max(obj.speed, self.maxSpeed)
    node = self.getNode(obj)
    node.left = self.bindChild(node, self.getTree(left))
    node.right = self.bindChild(node, self.getTree(right))
    node.resolution = self.distance(node.bounds)
    return node

  def initTree(self, coords):
    kd = new(KDTree(coords, self.distance, ['lat', 'lng']))
    self.tree = self.getTree(kd.root)

  def clearMarkers(self):
    if self.markers:
      def forEach(marker):
        return marker.setMap(None)
      self.markers.forEach(forEach)
    self.markers = []

  def copyNode(self, node):
    if not node:
      return None
    out = self.getNode(node)
    out.sum = node.sum
    out.count = node.count
    return out

  def groupChild(self, parent, child, resolution):
    if not child:
      return None
    if child.resolution > resolution:
      self.traverse(child, resolution)
    return self.bindChild(parent, self.copyNode(child))

  def traverse(self, node, resolution):
    if not node.bounds.intersects(self.map.getBounds()):
      return
    out = self.groupChild(None, node.left, resolution)
    out = self.groupChild(out, node.right, resolution)
    if self.map.getBounds().contains(self.toLatLng(node)):
      out = self.bindChild(self.getNode(node), out)
    if not out:
      return
    if out.sum < (10 ** -SIG_FIG):
      out.count = 0
    self.nodes.push(out)

  async def getMarkers(self, projection):
    if not self.ready:
      return
    await self.mapsReady
    self.clearMarkers()
    self.nodes = []
    ne = self.map.getBounds().getNorthEast()
    pixel = projection.fromLatLngToDivPixel(ne)
    pixel.x -= GRID_SIZE
    pixel.y += GRID_SIZE
    resolution = self.distance(ne, projection.fromDivPixelToLatLng(pixel))
    self.traverse(self.tree, resolution)
    def reduce(out, node):
      for other in out:
        if self.distance(other.bounds.getCenter(), node) < resolution:
          other.bounds.extend(self.toLatLng(node))
          other.sum += node.sum
          other.count += node.count
          return out
      out.push(node)
      return out
    def forEach(node):
      avg = node.sum / node.count
      scale = gradient.length * (avg / self.maxSpeed)
      self.markers.push(new(self.maps.Marker({
        'map': self.map,
        'position': node.bounds.getCenter(),
        'icon': {
          'path': 'M160 0 a 160 160 0 1 0 160 160 L 320 0 Z',
          'rotation': 135,
          'scale': (44 / 390),
          'fillColor': gradient[Math.floor(Math.min(scale, gradient.length - 1))],
          'fillOpacity': 1,
          'strokeColor': 'black',
          'strokeWeight': 2,
          'labelOrigin': { 'x': 160, 'y': 160 },
        },
        'label': {
          'fontSize': '12px',
          'text': '' + avg.toFixed(SIG_FIG),
        },
      })))
    self.nodes.reduce(reduce, []).forEach(forEach)

  def initMap(self):
    if not self.map:
      self.map = new(self.maps.Map(self.d_refs.map, {
        'center': self.tree.bounds.getCenter(),
        'zoom': 13,
        'minZoom': 5,
        'mapTypeControlOptions': { 'mapTypeIds': ['styled_map'] },
        'disableDefaultUI': True,
      }))
      self.map.mapTypes.set('styled_map', new(self.maps.StyledMapType(style)))
      self.map.setMapTypeId('styled_map')
    self.overlay = new(self.maps.OverlayView())
    proj = None
    def draw():
      proj = self.overlay.getProjection()
    self.overlay.draw = draw
    self.overlay.setMap(self.map)
    def getMarkers():
      self.getMarkers(proj)
    self.listener = self.map.addListener('bounds_changed', getMarkers)
    self.map.fitBounds(self.tree.bounds)

  async def prepare(self, groups):
    def reduce(arr, trip):
      return arr.concat(trip.coords)
    coords = groups.reduce(reduce, [])
    self.maps = await self.mapsReady
    self.initTree(coords)
    self.loading = False
    self.ready = True
    self.initMap()

  async def submit(self):
    self.loading = True
    def map(self, file):
      reader = new(FileReader())
      def promise(resolve):
        def onload(event):
          resolve(JSON.parse(event.target.result))
        reader.onload = onload
      out = new(Promise(promise))
      reader.readAsText(file)
      return out
    res = await Promise.all(Array['from'](self.d_refs.input.files).map(map))
    self.prepare(res)

  async def sample(self):
    self.loading = True
    res = await axios.get(tripsUrl)
    self.prepare(Object.values(res.data))

  def reset(self):
    self.d_refs.form.reset()
    self.tree = None
    self.nodes = None
    self.overlay.setMap(None)
    self.overlay = None
    self.maps.event.removeListener(self.listener)
    self.listener = None
    self.clearMarkers()
    Object.assign(self.d_data, self.d_options.data.apply(self))

  @classmethod
  def beforeDestroy(self):
    self.reset()

module.exports = require('begin-build/component')(component)
