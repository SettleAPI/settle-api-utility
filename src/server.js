const express = require('express');
const setupProxy = require('./setupProxy');
const short = require('short-uuid');
const app = express();

console.log('Serving static asserts from ./build')
app.use(express.static('build'));

setupProxy(app);


app.get('/credentials', function(req, res) {
  const credentials = {
    'userId': '76pj520h',
    'merchantId': 'f1645s',
    'secret': '.IIIXVCFdey3Bo5HD4gQh2+y_Ce9C.qodl_9FB.CQAWHua_rCrpCn3N-YwagvGY7',
  }
  const data = req.body
  console.log('-------------------------')
  console.log(req.method, req.url, short.generate())
  console.log(req.headers)
  console.log('body: ', data)
  res.json(credentials);
});

app.get('/callback', function(req, res) {
  const data = req.body
  console.log('-------------------------')
  console.log(req.method, req.url, short.generate())
  console.log(req.headers)
  console.log('body: ', data)
  if (!data) {
    console.log('No data, aborting')
    res.json({"status":"no body"});
    return;
  }
  console.assert(data['meta']['event'] === 'shortlink_scanned')

  const { id: scantoken, argstring: transaction_id } = data['object']

  res.json({
    "scantoken":scantoken,
    "transaction_id":transaction_id,
  });
});

console.log(`Listening to 0.0.0.0:80`)
app.listen(80);