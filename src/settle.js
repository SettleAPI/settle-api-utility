const axios = require('axios');

exports.configs = {
  'sandbox': {
    'testUserId': '76pj520h',
    'testMerchantId': 'f1645s',
    'testSecret': '.IIIXVCFdey3Bo5HD4gQh2+y_Ce9C.qodl_9FB.CQAWHua_rCrpCn3N-YwagvGY7',
    'deeplink': {
      env: 'settle-demo',
      baseUrl: 'settledemo.page.link',
      apn: 'eu.settle.app.demo',
      ibi: 'eu.settle.app.demo',
      isi: '1453180781'
    }
  },
  'prod': {
    'testUserId': '',
    'testMerchantId': '',
    'testSecret': '',
    'deeplink': {
      env: 'settle',
      baseUrl: 'get.settle.eu',
      apn: 'eu.settle.app',
      ibi: 'eu.settle.app',
      isi: '1440051902'
    }
  }
};


// https://developer.settle.eu/handlers.html#outcome
exports.outcomeDescriptions = {
  1003: `Waiting for customer ⏱`,
  2000: `Payment captured 🤑`,
  3008: `Payment authorized, ready for capture 💪`,
  4004: `No such customer 🤷‍♂️`,
  4019: `Merchant aborted payment before capture 😢`,
  5006: `Customer rejected payment request 😢`,
  5011: `Payment request expired ⏱`,
  5012: `Authorization not captured within 3 days ⏱`,
}

// https://developer.settle.eu/handlers.html#outcome
exports.statusCodes = {
  PENDING: 1003,
  OK: 2000,
  AUTH: 3008,
  NOT_FOUND: 4004,
  ABORTED: 4019,
  REJECTED: 5006,
  REQUEST_EXPIRED: 5011,
  AUTH_EXPIRED: 5012,
}


exports.doRequest = function (method, endpoint, credentials, payload) {
    const { merchantId, userId, secret } = credentials
    console.debug('Request:', method, endpoint, payload, credentials)
    return axios({
      method,
      url: endpoint,
      data: payload,
      headers: {
        'X-Auka-Merchant': merchantId,
        'X-Auka-User': userId,
        'Authorization': `SECRET ${secret}`
      },
    })
  };


  function getRandomInt(max = 5) {
    return Math.floor(Math.random() * Math.floor(max));
  }

  function getProductLine(name, amount, price) {
    return ` ${amount} x\t${name}\t\t\t\t\t\t${price} kr\n`
  }

  exports.getFakeProducts = function () {
    const fruits = ['Banana', 'Apple', 'Mango']
    const products = fruits.map(name => {
      return { name, amount: getRandomInt(5)+1, price: (getRandomInt(10)+1) }
    });
    const list = products.map(({ name, amount, price }) => {
      return getProductLine(name, amount, price)
    }).join('');
    const total = products.reduce((previousValue, currentValue) => {
      return previousValue + currentValue.price
    }, 0) * 100
    console.log(total, list)

    return { list, total }
  }


  exports.getDeepLink = function (shortlinkUrl, environment) {
    const config = exports.configs[environment].deeplink;

    const url = [
      'https://',
      config.baseUrl,
      '?apn=' + config.apn,
      '&ibi=' + config.ibi,
      '&isi=' + config.isi,
      '&ius=eu.settle.app.firebaselink',
      '&link=https://' + config.env + '://qr/' + encodeURI(shortlinkUrl),
    ].join('');

    return url;
  }