const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/sandbox',
    createProxyMiddleware({
      target: 'https://api.sandbox.settle.eu/',
      changeOrigin: true,
      pathRewrite: {'^/sandbox' : ''}
    })
  );
  app.use(
    '/prod',
    createProxyMiddleware({
      target: 'https://api.settle.eu/',
      changeOrigin: true,
      pathRewrite: {'^/prod' : ''}
    })
  );
};