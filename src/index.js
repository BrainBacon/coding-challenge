let build = require('begin-build');

// HACK: vue-loader exports an ES module and doesn't support CommonJS
module.exports = build({
  components: { app: require('./app/component.vue').default },
});

