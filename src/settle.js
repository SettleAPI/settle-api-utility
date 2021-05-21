import axios from 'axios';

export const configs = {
  'sandbox': {
    'testUserId': '76pj520h',
    'testMerchantId': 'f1645s',
    'testSecret': '.IIIXVCFdey3Bo5HD4gQh2+y_Ce9C.qodl_9FB.CQAWHua_rCrpCn3N-YwagvGY7',
    'deeplink': {
      env: 'settle-demo',
      baseUrl: 'settledemo.page.link',
      apn: 'eu.settle.app.sandbox',
      ibi: 'eu.settle.app.sandbox',
      isi: '1453180781'
    }
  },
  'production': {
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
export const outcomeDescriptions = {
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
export const statusCodes = {
  PENDING: 1003,
  OK: 2000,
  AUTH: 3008,
  NOT_FOUND: 4004,
  ABORTED: 4019,
  REJECTED: 5006,
  REQUEST_EXPIRED: 5011,
  AUTH_EXPIRED: 5012,
}

let requestCounter = 0;
export const doRequest = async function (method, endpoint, credentials, payload) {
  const { merchantId, userId, secret } = credentials
  console.debug(`[${++requestCounter}] REQUEST`, method, endpoint, credentials, payload)
  let response;
  try {
    response = await axios({
      method,
      url: endpoint,
      data: payload,
      headers: {
        'X-Auka-Merchant': merchantId,
        'X-Auka-User': userId,
        'Authorization': `SECRET ${secret}`
      },
    })
    console.debug(`[${requestCounter}] RESPONSE ${response.status}:`, response.data)
    return response;
  } catch (error) {
    if (error.response) {
      console.debug(`[${requestCounter}] RESPONSE ${error.response.status}:`, error.response.data)
    } else {
      console.debug(`[${requestCounter}] RESPONSE ${error}:`, error)
    }
    console.error(error)
    throw error;
  }

};

export const getFakeProducts = function () {
  const catalog = [
    { name: '🍐 Pear      ', price: 2 },
    { name: '🍎 Apple   ', price: 2 },
    { name: '🍌 Banana ', price: 3 },
    { name: '🍇 Grapes ', price: 4 },
    { name: '🥭 Mango  ', price: 5 },
    { name: '🍒 Cherry  ', price: 6 },
  ]

  function getRandomInt(max = 5) {
    return Math.floor(Math.random() * Math.floor(max));
  }

  function formattedProduct(name, amount, price) {
    return ` ${amount} x\t${name}              \t${price} kr\n`
  }

  const wishList = [];
  while (wishList.length < 3) {
    const randomItem = catalog[Math.floor(Math.random() * catalog.length)];
    if (!wishList.includes(randomItem)) {
      wishList.push(randomItem);
    }
  }

  const shoppingCart = wishList.map(fruit => {
    const amount = getRandomInt(3) + 1;
    return { name: fruit.name, amount, price: fruit.price * amount }
  });

  const formattedList = shoppingCart.map(({ name, amount, price }) => {
    return formattedProduct(name, amount, price)
  }).join('');

  const totalCost = shoppingCart.reduce((previousValue, currentValue) => {
    return previousValue + currentValue.price
  }, 0) * 100

  return { formattedList, totalCost }
}


export const getDeepLink = function (shortlinkUrl, environment) {
  const config = configs[environment].deeplink;

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

export default { configs, outcomeDescriptions, statusCodes, doRequest, getFakeProducts, getDeepLink };