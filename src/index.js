let build = require('begin-build');

module.exports = build({
  components: { app: require('./app/vue.pug') },
});

