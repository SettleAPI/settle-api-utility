const express = require('express');
const path = require('path');

const app = express();
const credentials = {
  'userId': '76pj520h',
  'merchantId': 'f1645s',
  'secret': '.IIIXVCFdey3Bo5HD4gQh2+y_Ce9C.qodl_9FB.CQAWHua_rCrpCn3N-YwagvGY7',
}

app.use(express.static(path.join(__dirname, 'build')));
app.get('/', function(req, res) {
  const data = req.body
  console.log(req.headers)
  console.log('body: ', data)
  res.json({"ping":"pong"});
});
app.get('/credentials', function(req, res) {
  const data = req.body
  console.log(req.headers)
  console.log('body: ', data)
  res.json(credentials);
});
app.get('/callback', function(req, res) {
  const data = req.body
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

console.log(`Listening to 0.0.0.0:9000`)
app.listen(9000);