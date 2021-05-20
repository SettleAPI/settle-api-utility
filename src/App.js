import React from 'react';
import logo from './settle-logo.png';
import settle from './settle.js';
import short from 'short-uuid';
import qr from 'qrious'
import './App.css';


/* ToDO:
  - Support callback flow via interaction with HTTP server
  - Visualisations
  - LineItems
  - Redirection links
*/

const steps = {
  CREDENTIALS: 1,
  DEMO: 2,
  OUTCOME: 3,
  SHORTLINK: 4,
  PAYMENT_REQUEST: 5,
  ORDER: 6,
}

const demos = {
  PHONENUMBER: 'phonenumber',
  PAYMENTLINK: 'paymentlink',
  SHORTLINK_REUSE: 'shortlink_reuse',
  SHORTLINK_SINGLE: 'shortlink_single',
}

// return last value, or default if not found in local storage
function getStoredSetting(name, defaultValue) {
  let storedValue = localStorage.getItem(`settle-api-utility.config.${name}`);
  if (storedValue === 'true') {
    storedValue = true;
  } else if (storedValue === 'false') {
    storedValue = false;
  }
  const value = storedValue !== null ? storedValue : defaultValue
  console.log(`Option ${name}:`, value);
  return value;
}

// set initial config key/value in local storage
function setStoredSetting(name, value) {
  localStorage.setItem(`settle-api-utility.config.${name}`, value);
}

class App extends React.Component {

  constructor(props) {
    super(props);
    const products = settle.getFakeProducts();
    this.state = {
      environment: getStoredSetting('environment', 'sandbox'),
      merchantId: getStoredSetting('merchantId', settle.configs['sandbox'].testMerchantId),
      userId: getStoredSetting('userId', settle.configs['sandbox'].testUserId),
      secret: getStoredSetting('secret', settle.configs['sandbox'].testSecret),
      shortlinkId: null,
      shortlinkIdWithCallback: null,
      shortlinkIdNoCallback: null,
      callbackUri: getStoredSetting('callbackUri', 'http://api-utility.settle.eu/callback/'),
      step: steps.CREDENTIALS,
      loadingCredentials: false,
      loadingFlow: false,
      loadingShortlink: false,
      loadingPaymentRequest: false,
      loadingScan: false,
      isScanned: false,
      demo: getStoredSetting('demo', demos.PHONENUMBER),
      outcome: getStoredSetting('outcome', 'polling'),
      phonenumber: getStoredSetting('phonenumber', ''),
      autoCapture: getStoredSetting('autoCapture', true),
      advancedRequestOptions: getStoredSetting('advancedRequestOptions', false),
      amount: products.totalCost,
      additionalAmount: getStoredSetting('additionalAmount', 0),
      additionalEdit: getStoredSetting('additionalEdit', false),
      allowCredit: getStoredSetting('allowCredit', true),
      currency: getStoredSetting('currency', 'NOK'),
      customer: '',
      action: getStoredSetting('action', 'SALE'),
      posTid: short.generate(),
      posId: getStoredSetting('posId', 'pos123'),
      requiredScope: getStoredSetting('requiredScope', ''),
      message: products.formattedList,
      statusLog: [],
      apiLog: [],
      loaderRequest: false,
    }
  }

  async doRequest(method, endpoint, body) {
    const { environment, merchantId, userId, secret } = this.state;
    this.setState({ loadingRequest: true })
    try {
      const response = await settle.doRequest(method, `/${environment}${endpoint}`, {
        merchantId,
        userId,
        secret,
      }, body)
      this.setState({ loadingRequest: false })
      this.addAPILogEntry(method, endpoint, body, response.status)
      return response
    } catch (error) {
      console.log(error.response)
      let logEntry;
      if (error.response) {
        logEntry = `${error.response.statusText}. ${error.response.data.error_description}`
      }
      else {
        logEntry = error.message
      }
      this.addLogEntry(logEntry)
      this.addAPILogEntry(method, endpoint, body, error.response && error.response.status)
      throw error
    }
  };

  createNewOrder() {
    this.addLogEntry('Generated new order')
    const products = settle.getFakeProducts();
    this.setState({
      posTid: short.generate(),
      amount: products.totalCost,
      message: products.formattedList,
      currentTransactionId: null,
    });
  }

  resetDemo() {
    // Reset QR code
    const canvas = document.getElementById('qr');
    // eslint-disable-next-line no-self-assign
    if (canvas) canvas.width = canvas.width // quick and dirty reset of QR canvas

    // reset payment state
    this.setState({
      loadingPaymentRequest: false,

      acceptanceUrl: '',
      isScanned: false,
      step: steps.PAYMENT_REQUEST,
    });

    this.createNewOrder();
  }

  renderQRCode(acceptanceUrl) {
    new qr({
      element: document.getElementById('qr'),
      value: acceptanceUrl,
      size: 200,
    })
  }

  handleChange(event) {
    const target = event.target;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    const name = target.name;

    this.setState({
      [name]: value
    });

    setStoredSetting(name, value);

    if (name === 'callbackUri') {
      this.setState({ shortlinkIdWithCallback: '' })
    }

    if (name === 'outcome' && value === 'callback') {
      this.setState({ shortlinkId: this.state.shortlinkIdWithCallback })
    }

    if (name === 'outcome' && value === 'polling') {
      this.setState({ shortlinkId: this.state.shortlinkIdNoCallback })
    }
  }

  prepareDemo() {
    const { demo, phonenumber, shortlinkIdWithCallback, shortlinkIdNoCallback } = this.state;
    let shortlinkId = null;
    let customer = '';


    if (this.isOutcomeCallback()) {
      if (!this.state.shortlinkIdWithCallback) {
        throw Error("Unable to get or create shortlink");
      }
      shortlinkId = shortlinkIdWithCallback;
    } else {
      shortlinkId = shortlinkIdNoCallback;
    }

    switch (demo) {
      case demos.PHONENUMBER:
        customer = `msisdn:${phonenumber}`;
        break;
      case demos.SHORTLINK_REUSE:
      case demos.SHORTLINK_SINGLE:
        customer = `shortlink_id:${shortlinkId}`;
        break;
      case demos.PAYMENTLINK:
      default:
    }

    this.setState({ customer, shortlinkId });
  }

  async capturePayment(tid) {
    await this.doRequest('PUT', `/merchant/v1/payment_request/${tid}/`, { 'action': 'capture' });
  }

  async abortPayment(tid) {
    const { currentTransactionId } = this.state;
    await this.doRequest('PUT', `/merchant/v1/payment_request/${tid}/`, { 'action': 'abort' });
    this.addLogEntry(`Aborted payment request ${currentTransactionId}`)
    this.setState({ currentTransactionId: null });
  }

  async releasePayment(tid) {
    await this.doRequest('PUT', `/merchant/v1/payment_request/${tid}/`, { 'action': 'release' });
  }

  handleCapture() {
    const { currentTransactionId } = this.state;
    this.capturePayment(currentTransactionId);
  }

  handleAbort(event) {
    const { currentTransactionId } = this.state;
    this.abortPayment(currentTransactionId);
  }

  handleRelease(event) {
    const { currentTransactionId } = this.state;
    this.releasePayment(currentTransactionId);
  }

  handleCredentials(event) {
    this.setState({ loadingCredentials: true });
    const userId = this.state.userId;

    this.doRequest('GET', `/merchant/v1/api_key/${userId}/`, '')
      .then(response => {
        const statusMessage = `Merchant credentials validated.`
        this.setState({
          loadingCredentials: false,
          step: 2,
          isValid: true,
          credStatus: statusMessage
        })
        this.addLogEntry(statusMessage);
      })
      .catch(error => {
        this.setState({
          loadingCredentials: false,
          credStatus: error.message
        })
      })
  }

  handleNext(event) {
    const { step, demo } = this.state
    let nextStep = step + 1;
    if (step === steps.DEMO && (demo === demos.PHONENUMBER || demo === demos.PAYMENTLINK)) nextStep += 1;
    if (step === steps.SHORTLINK) this.prepareDemo();
    this.setState({ step: nextStep })
    // console.log('Step:', step, ' Next:', nextStep, 'Demo: ', demo)
  }

  handlePrevious(event) {
    const { step, demo } = this.state
    let prevStep = step - 1;
    if (step === steps.SHORTLINK && (demo === demos.PHONENUMBER || demo === demos.PAYMENTLINK)) prevStep -= 1
    this.setState({ step: prevStep })
    // console.log('Step:', step, ' Prev:', prevStep, 'Demo: ', demo)
  }

  async handleCreateShortlink(event) {
    try {
      this.setState({ loadingShortlink: true })
      const response = await this.doRequest('GET', '/merchant/v1/shortlink/', {});
      const urlList = response.data.uris;
      const deferreds = urlList.map(url => this.getLinkUrl(url));
      this.addLogEntry('');
      this.addLogEntry(`Analysing ${urlList.length} existing shortlinks`);

      Promise.all(deferreds).then(results => {
        this.createMissingLinks();
        this.setState({
          loadingShortlink: false,
        });
      });

    } catch (error) {
      console.error(error)
      this.addLogEntry(error.message)
    }
  }

  handleClear(event) {
    this.setState({
      merchantId: '',
      userId: '',
      secret: '',
      credStatus: '',
    })
  }

  handleStopDemo(event) {
    this.addLogEntry('Demo stopped');
    this.setState({
      demoStarted: false,
    })
    this.resetDemo();
  }

  addLogEntry(message) {
    const { statusLog, lastStatusMessage } = this.state
    if (message === lastStatusMessage) {
      return;
    }
    console.log(`log > ${message}`)
    statusLog.push({ id: statusLog.length, message });
    this.setState({ statusLog, lastStatusMessage: message })
  };

  addAPILogEntry(method, endpoint, bodyObject, status) {
    const body = JSON.stringify(bodyObject)

    let { apiLog } = this.state
    if (apiLog.length > 0) {
      const previous = apiLog[apiLog.length - 1]
      const isMatching = previous.method === method
        && previous.endpoint === endpoint
        && previous.body === body
        && previous.status === status

      if (isMatching) {
        apiLog[apiLog.length - 1].duplicates = previous.duplicates + 1
        return;
      }
    }

    const logEntry = { id: apiLog.length, method, endpoint, body, status, duplicates: 0 };
    apiLog.push(logEntry);
    this.setState({ apiLog })
  };

  /*
    PENDING: `Waiting for customer ⏱`,
    OK: `Payment captured 🤑`,
    AUTH: `Payment authorized, ready for capture 💪`,
    NOT_FOUND: `No such customer 🤷‍♂️`,
    ABORTED: `Merchant aborted payment before capture 😢`,
    REJECTED: `Customer rejected payment request 😢`,
    REQUEST_EXPIRED: `Payment request expired ⏱`,
    AUTH_EXPIRED: `Authorization not captured within 3 days ⏱`,
  */
  async checkOutcome() {
    const { currentTransactionId, autoCapture, isScanned } = this.state;

    if (currentTransactionId) {
      try {
        const response = await this.doRequest('GET', `/merchant/v1/payment_request/${currentTransactionId}/outcome/`);
        const { status_code, customer } = response.data;

        if (!isScanned && customer.includes('token')) {
          this.addLogEntry('Customer scanned QR code')
          this.setState({ isScanned: true })
        }

        this.addLogEntry(settle.outcomeDescriptions[status_code])

        if (status_code === settle.statusCodes.AUTH) {
          console.log('Auto capture:', autoCapture)
          if (autoCapture) {
            this.capturePayment(currentTransactionId);
          }
        }
        if (status_code === settle.statusCodes.OK || status_code === settle.statusCodes.ABORTED || status_code === settle.statusCodes.REJECTED || status_code === settle.statusCodes.REQUEST_EXPIRED) {
          this.setState({ currentTransactionId: null })
        }
      } catch (error) {
        setTimeout(() => this.checkOutcome(), 1000);
        return;
      }
    }
    setTimeout(() => this.checkOutcome(), 1000);
    return;
  };

  isOutcomeCallback() {
    return this.state.outcome === 'callback';
  };

  isOutcomePolling() {
    return this.state.outcome === 'polling';
  };

  async createMissingLinks() {
    const { callbackUri } = this.state;
    if (!this.state.shortlinkIdWithCallback) {
      try {
        const response = await this.doRequest('POST', '/merchant/v1/shortlink/', { 'callback_uri': callbackUri })
        const link = response.data
        this.addLogEntry(`Created link ${link.id} with callback ${callbackUri}`);
        this.setState({ shortlinkIdWithCallback: link.id });
      } catch (error) {
        this.addLogEntry(`Could not create link`);
      }
    }
    if (!this.state.shortlinkIdNoCallback) {
      try {
        const response = await this.doRequest('POST', '/merchant/v1/shortlink/', { 'callback_uri': null })
        const link = response.data
        console.log('Created', link.id, 'without callback');
        this.setState({ shortlinkIdNoCallback: link.id })
      } catch (error) {
        this.addLogEntry(`Could not create link`);
      }
    }
  };

  async createPaymentRequest() {
    const {
      action,
      amount,
      additionalAmount,
      additionalEdit,
      allowCredit,
      currency,
      message,
      customer,
      posId,
      posTid,
      requiredScope,
      callbackUri,
    } = this.state;

    let body = {
      'action': action,
      'amount': parseInt(amount),
      'currency': currency,
      'pos_id': posId,
      'pos_tid': posTid,
      'allow_credit': allowCredit,
      'text': message,
      'additional_amount': parseInt(additionalAmount),
      'additional_edit': additionalEdit,
      //display_message_uri': 'Fooobar?',
      // 'success_return_uri': 'http://www.google.com',
      // 'failure_return_uri': 'http://www.auka.io',
      // 'line_items': [ {
      //   'product_id': 'abc123',
      //   'description': 'Blue jeans',
      //   'vat_rate': '0.00',
      //   'quantity': '2',
      //   'currency': 'NOK',
      //   'item_cost': 500,
      //   'total': 1000
      // }]
    }
    if (requiredScope !== '') body.requiredScope = requiredScope
    if (customer !== '') body.customer = customer
    if (this.isOutcomeCallback()) body.callbackUri = callbackUri


    const response = await this.doRequest('POST', '/merchant/v1/payment_request/', body)
    const tid = response.data.id;
    this.addLogEntry(`Created payment request ${tid}`)
    this.setState({
      currentTransactionId: tid,
    })
    return tid

  }

  getShortlinkUrl(localId) {
    const { shortlinkId } = this.state;
    return `http://settle.eu/s/${shortlinkId}/${localId}/`;
  };

  getPaymentlinkURL(transactionId) {
    return `http://settle.eu/p/${transactionId}/`;
  };

  async handleStartDemo() {
    const { posId, posTid, demo } = this.state;

    this.addLogEntry('') // insert blank as delimeter
    this.addLogEntry(`Starting ${demo} demo`)
    this.setState({
      loadingPaymentRequest: true,
      demoStarted: true,
    })

    let tid;
    if (demo === demos.PHONENUMBER || demo === demos.PAYMENTLINK) {
      tid = await this.createPaymentRequest();
    }

    let acceptanceUrl;
    if (demo === demos.PAYMENTLINK) {
      acceptanceUrl = this.getPaymentlinkURL(tid);
    }
    if (demo === demos.SHORTLINK_REUSE) {
      acceptanceUrl = this.getShortlinkUrl(posId);
    }
    if (demo === demos.SHORTLINK_SINGLE) {
      acceptanceUrl = this.getShortlinkUrl(posTid);
    }

    this.setState({
      loadingPaymentRequest: false,
      currentTransactionId: tid,
      acceptanceUrl,
      step: steps.ORDER,
    }, () => {
      if (demo !== demos.PHONENUMBER) this.renderQRCode(acceptanceUrl);
      this.checkOutcome();
    })
  }

  handleCreatePaymentRequest() {
    this.createPaymentRequest();
  }

  async getLinkUrl(uri) {
    var parts = uri.split('/'),
      linkId = parts[parts.length - 2];

    const response = await this.doRequest('GET', `/merchant/v1/shortlink/${linkId}/`, {});
    const link = response.data;
    let message;
    console.log('callback', link.id, link.callback_uri)
    if (!link.callback_uri && !this.state.shortlinkIdNoCallback) {
      this.setState({ shortlinkIdNoCallback: link.id })
      message = `Using link ${link.id} for outcome polling`;
      this.addLogEntry(message)
    }
    if (link.callback_uri === this.state.callbackUri) {
      this.setState({ shortlinkIdWithCallback: link.id, })
      message = `Using link ${link.id} for outcome callback ${link.callback_uri}`
      this.addLogEntry(message);
    }

  };

  render() {
    const {
      step,
      demo,
      posId,
      posTid,
      amount,
      userId,
      secret,
      action,
      apiLog,
      message,
      customer,
      currency,
      statusLog,
      merchantId,
      credStatus,
      phonenumber,
      environment,
      callbackUri,
      allowCredit,
      autoCapture,
      acceptanceUrl,
      loaderRequest,
      requiredScope,
      additionalEdit,
      additionalAmount,
      loadingShortlink,
      lastStatusMessage,
      loadingCredentials,
      currentTransactionId,
      shortlinkIdNoCallback,
      loadingPaymentRequest,
      advancedRequestOptions,
      shortlinkIdWithCallback,
    } = this.state

    const isDemoPhonenumber = demo === demos.PHONENUMBER;
    const isDemoQRShortlinkReuse = demo === demos.SHORTLINK_REUSE;
    const isDemoQRShortlinkSingle = demo === demos.SHORTLINK_SINGLE;
    const isDemoQRPaymentlink = demo === demos.PAYMENTLINK;
    const isOutcomeCallback = this.isOutcomeCallback();
    const isOutcomePolling = this.isOutcomePolling();
    const mobileFriendlyURL = settle.getDeepLink(acceptanceUrl, environment);
    const shortlinkId = isOutcomeCallback ? shortlinkIdWithCallback : shortlinkIdNoCallback

    return (
      <main className="App">
        <header className="App-header">
          <div className="App-content">
            <img src={logo} className="App-logo hide-sm" alt="logo" />
            <div className="App-title hide-md"><h2>API&nbsp;Utility</h2></div>
            <div className="App-controls pure-form pure-form-aligned">
              <div className="pure-control-group">
                <label className="hide-md">Merchant: </label><strong>{merchantId}:{userId}</strong>&nbsp;&nbsp;&nbsp;&nbsp;
              </div>
              <div className="pure-control-group">
                <label htmlFor="environment" className="hide-md">Environment:</label>
                <select
                  className="App-headerInput"
                  id="environment"
                  name="environment"
                  value={environment}
                  onChange={(event) => this.handleChange(event)} >
                  <option>sandbox</option>
                  <option>production</option>
                </select>
              </div>
            </div>
          </div>
        </header>

        <div className="content">
          <h1>POS Demo</h1>
          <div className="pure-g">

            <div className="pure-u-1 pure-u-md-1-2 pure-u-lg-1-3">
              <div className="pure-form pure-form-stacked">
                {step === steps.CREDENTIALS &&
                  <div className="box">
                    <h2>Credentials</h2>
                    <p>Let's first validate your credentials, for this you first need to set up an integration in the <a href="https://business.sandbox.settle.eu" target="_blank" rel="noopener noreferrer">Settle Business Portal</a>.</p><p> Meanwhile, we have some merchant credentials you can test with.</p>

                    <div className="pure-control-group">
                      <label>Merchant ID</label>
                      <input
                        name="merchantId"
                        type="text"
                        value={merchantId}
                        onChange={(event) => this.handleChange(event)} />
                    </div>
                    <div className="pure-control-group">
                      <label>User ID</label>
                      <input name="userId"
                        type="text"
                        value={userId}
                        onChange={(event) => this.handleChange(event)} />
                    </div>
                    <div className="pure-control-group">
                      <label>Secret</label>
                      <input name="secret"
                        type="text"
                        value={secret}
                        onChange={(event) => this.handleChange(event)} />
                    </div>
                    {!loadingCredentials && <div className="pure-control-group button-group">
                      <button className="pure-button" type="button" onClick={(event) => this.handleClear(event)}>Clear</button>
                      <button className="pure-button pure-button-primary" type="button" onClick={(event) => this.handleCredentials(event)}>Next</button>
                    </div>}
                    <div id="credential-status">
                      {loadingCredentials && <div className="loader"></div>}
                      <p>{credStatus}</p>
                    </div>
                  </div>}

                {step === steps.DEMO &&
                  <div className="box">

                    <h2>Choose demo</h2>

                    <div className="pure-control-group">
                      <label htmlFor="phonenumber" className="pure-radio">
                        <input
                          type="radio"
                          name="demo"
                          id="phonenumber"
                          value="phonenumber"
                          checked={isDemoPhonenumber}
                          onChange={(event) => this.handleChange(event)} />
                          &nbsp;&nbsp;Phonenumber
                        </label>
                      <span className="pure-form-message-inline">Send payment request to user phone.</span>
                    </div>

                    <div className="pure-control-group">
                      <label htmlFor="paymentlink" className="pure-radio">
                        <input
                          type="radio"
                          name="demo"
                          id="paymentlink"
                          value="paymentlink"
                          checked={isDemoQRPaymentlink}
                          onChange={(event) => this.handleChange(event)} />
                          &nbsp;&nbsp;Paymentlink
                        </label>
                      <span className="pure-form-message-inline">Create payment request to be claimed by user.</span>
                    </div>

                    <div className="pure-control-group">
                      <label htmlFor="shortlink_reuse" className="pure-radio">
                        <input
                          type="radio"
                          name="demo"
                          id="shortlink_reuse"
                          value="shortlink_reuse"
                          checked={isDemoQRShortlinkReuse}
                          onChange={(event) => this.handleChange(event)} />
                          &nbsp;&nbsp;Shortlink (reuseable)
                        </label>
                      <span className="pure-form-message-inline">Create payment request for POS when user scans.</span>
                    </div>

                    <div className="pure-control-group">
                      <label htmlFor="shortlink_single" className="pure-radio">
                        <input
                          type="radio"
                          name="demo"
                          id="shortlink_single"
                          value="shortlink_single"
                          checked={isDemoQRShortlinkSingle}
                          onChange={(event) => this.handleChange(event)} />
                          &nbsp;&nbsp;Shortlink (single use)
                        </label>
                      <span className="pure-form-message-inline">Create payment request for POS TID when user scans.</span>
                    </div>

                    {isDemoPhonenumber && <>
                      <h3>Demo options</h3>
                      <div className="pure-control-group">

                        <label htmlFor="phonenumber">Recipient phone number</label>
                        <input
                          className="pure-input-2-5"
                          name="phonenumber"
                          type="text"
                          id="phonenumber"
                          value={phonenumber}
                          onChange={(event) => this.handleChange(event)} />
                        <span className="pure-form-message-inline">Needs to be <a href="https://en.wikipedia.org/wiki/MSISDN">MSISDN</a> formatted</span>
                      </div>
                    </>}


                    <div>
                      <div className="pure-control-group button-group">
                        <button className="pure-button" type="button" onClick={(event) => this.handlePrevious(event)}>Previous</button>
                        <button className="pure-button pure-button-primary" type="button" onClick={(event) => this.handleNext(event)}>Next</button>
                      </div>
                    </div>
                  </div>}

                {step === steps.OUTCOME &&
                  <div className="box">
                    <h2>Outcome</h2>
                    <div>

                      <p>The outcome of a payment request can be polled for or a custom webhook that handles status changes can be registered with the Callback URI property.</p>
                      <p>Webhook is preferred if the network policy of the POS environment allows for it.</p>

                      <h3>Outcome options</h3>
                      <div className="pure-control-group">
                        <label htmlFor="polling" className="pure-radio">
                          <input
                            type="radio"
                            name="outcome"
                            id="polling"
                            value="polling"
                            checked={isOutcomePolling}
                            onChange={(event) => this.handleChange(event)} />
                          &nbsp;&nbsp;Polling
                        </label>
                        <span className="pure-form-message-inline">Continuously poll for changes by calling GET on <strong>/payment_request/&lt;tid&gt;/outcome/</strong></span>
                      </div>

                      <div className="pure-control-group">
                        <label htmlFor="callback" className="pure-radio">
                          <input
                            type="radio"
                            name="outcome"
                            id="callback"
                            value="callback"
                            checked={isOutcomeCallback}

                            onChange={(event) => this.handleChange(event)} />
                          &nbsp;&nbsp;Webhook
                        </label>
                        <span className="pure-form-message-inline">When the status of the payment request changes. The data in the "object" part of the message is the same as calling GET on <strong>/payment_request/&lt;tid&gt;/outcome/</strong></span>
                      </div>

                      <div className="pure-control-group">
                        <label htmlFor="callbackUri">Callback URI</label>
                        <input
                          className="pure-input-1"
                          name="callbackUri"
                          type="text"
                          id="callbackUri"
                          value={callbackUri}

                          onChange={(event) => this.handleChange(event)} />
                        <span className="pure-form-message-inline">URL for webhook handling callbacks</span>
                      </div>

                      <div className="pure-control-group button-group">
                        <button className="pure-button" type="button" onClick={(event) => this.handlePrevious(event)}>Previous</button>
                        <button className="pure-button pure-button-primary" type="button" onClick={(event) => this.handleNext(event)}>Next</button>
                      </div>
                    </div>
                  </div>}

                {step === steps.SHORTLINK &&
                  <div className="box">
                    <h2>Shortlinks</h2>
                    <div>
                      <p>A Shortlink is a placeholder and trigger point for payment request creation. Shortlinks can only handle one customer at a time, but can be reused my many different customers. As the POS usually only service one customer at a time, having one dedicated Shortlink per POS is usually fine. </p>
                      <p>To avoid unnecessary API calls during the payment cycle it's best to create dedicated Shortlinks as part of the POS setup phase. </p>
                      <p>In this demo we will first try to retrieve any current links for this merchant and otherwise create a new one with the desired callback URL.</p>
                      <div className="pure-control-group button-group">
                        {!loadingShortlink && !shortlinkId &&
                          <button className="pure-button pure-button-primary" type="button" onClick={(event) => this.handleCreateShortlink(event)}>
                            Retrieve shortlinks
                          </button>
                        }
                        {loadingShortlink && <div className="loader"></div>}
                        {!loadingShortlink && shortlinkId && <span>Done!</span>}
                      </div>
                      <p></p>
                      <div className="pure-control-group button-group">
                        <button className="pure-button" type="button" onClick={(event) => this.handlePrevious(event)}>Previous</button>
                        <button className="pure-button pure-button-primary" type="button" disabled={!shortlinkId} onClick={(event) => this.handleNext(event)}>Next</button>
                      </div>
                    </div>
                  </div>}

                {step === steps.PAYMENT_REQUEST &&
                  <div className="box">
                    <h2>Setup payment request</h2>
                    <div className="container" id="transaction">

                      <p>The customer can either reject or authorize a payment request. An authorization is valid for 3 days, but can be reauthorized before it expires to be valid for 3 new days. Once the payment is authorized, it can be captured to be included in the next settlement.</p>

                      <div className="pure-control-group">
                        <label htmlFor="advancedRequestOptions" className="pure-checkbox">
                          <input
                            type="checkbox"
                            name="advancedRequestOptions"
                            id="advancedRequestOptions"
                            value="advancedRequestOptions"
                            checked={advancedRequestOptions}
                            onChange={(event) => this.handleChange(event)} />
                          &nbsp;&nbsp;Advanced options
                        </label>
                      </div>

                      {isDemoQRShortlinkReuse && <>
                        <h3>Shortlink ID in use</h3>
                        <span>{shortlinkId}</span>
                      </>}

                      <h3>Request options</h3>
                      {advancedRequestOptions &&
                        <div className="pure-control-group">
                          <label htmlFor="action">Action</label>
                          <input
                            className="pure-input-1-4"
                            name="action"
                            type="text"
                            id="action"
                            value={action}
                            onChange={(event) => this.handleChange(event)} />
                        </div>}
                      <div className="pure-control-group">
                        <label htmlFor="amount">Amount (in cents)</label>
                        <input
                          className="pure-input-1-4"
                          name="amount"
                          type="number"
                          id="amount"
                          value={amount}
                          onChange={(event) => this.handleChange(event)} />
                        <span className="pure-form-message-inline">The base amount of the payment.</span>
                      </div>
                      {advancedRequestOptions &&
                        <div className="pure-control-group">
                          <label htmlFor="additionalAmount">additionalAmount (in cents)</label>
                          <input
                            className="pure-input-1-4"
                            name="additionalAmount"
                            type="number"
                            id="additionalAmount"
                            value={additionalAmount}
                            onChange={(event) => this.handleChange(event)} />
                          <span className="pure-form-message-inline">Typically a cash withdrawal or gratuity</span>
                        </div>}
                      {advancedRequestOptions &&
                        <div className="pure-control-group">
                          <label htmlFor="callbackUri">Callback URI</label>
                          <input
                            className="pure-input-1"
                            name="callbackUri"
                            type="text"
                            id="callbackUri"
                            value={isOutcomeCallback ? callbackUri : ''}
                            onChange={(event) => this.handleChange(event)}
                            disabled={isOutcomePolling}
                          />
                          <span className="pure-form-message-inline">URL for server handling callbacks.</span>
                        </div>}
                      {advancedRequestOptions &&
                        <div className="pure-control-group">
                          <label htmlFor="additionalEdit">
                            <input
                              type="checkbox"
                              name="additionalEdit"
                              id="additionalEdit"
                              value="additionalEdit"
                              checked={additionalEdit}
                              onChange={(event) => this.handleChange(event)} />
                            &nbsp;&nbsp;Additional edit</label>
                          <span className="pure-form-message-inline">Whether user is allowed to add additional amount for gratuity or similar.</span>
                        </div>}
                      {advancedRequestOptions &&
                        <div className="pure-control-group">
                          <label htmlFor="allowCredit">
                            <input
                              type="checkbox"
                              name="allowCredit"
                              id="allowCredit"
                              value="allowCredit"
                              checked={allowCredit}
                              onChange={(event) => this.handleChange(event)} />
                            &nbsp;&nbsp;Allow credit funding</label>
                          <span className="pure-form-message-inline">Whether to allow credit payment for this payment request. Credit incurs interchange.</span>
                        </div>}
                      {advancedRequestOptions &&
                        <div className="pure-control-group">
                          <label htmlFor="currency">Currency</label>
                          <input
                            className="pure-input-1-4"
                            name="currency"
                            type="text"
                            id="currency"
                            value={currency}
                            onChange={(event) => this.handleChange(event)} />
                          <span className="pure-form-message-inline">Three (3) chars following <a href="https://en.wikipedia.org/wiki/ISO_4217">ISO 4217</a></span>
                        </div>}
                      <div className="pure-control-group">
                        <label htmlFor="message">Message</label>
                        <textarea
                          className="pure-input-1"
                          name="message"
                          type="text"
                          id="message"
                          rows="5"
                          value={message}
                          onChange={(event) => this.handleChange(event)} ></textarea>
                      </div>
                      {advancedRequestOptions &&
                        <div className="pure-control-group">
                          <label htmlFor="customer">Customer</label>
                          <input
                            className="pure-input-2-4"
                            name="customer"
                            type="text"
                            id="customer"
                            value={customer}
                            onChange={(event) => this.handleChange(event)}
                          />
                        </div>}
                      {advancedRequestOptions &&
                        <div className="pure-control-group">
                          <label htmlFor="posId">POS ID</label>
                          <input
                            className="pure-input-1-4"
                            name="posId"
                            type="text"
                            id="posId"
                            value={posId}
                            onChange={(event) => this.handleChange(event)} />
                          <span className="pure-form-message-inline">The POS this payment request originates from, used for informing users.</span>
                        </div>}
                      {advancedRequestOptions &&
                        <div className="pure-control-group">
                          <label htmlFor="posTid">POS Transaction ID</label>
                          <input
                            className="pure-input-3-4"
                            name="posTid"
                            type="text"
                            id="posTid"
                            value={posTid}
                            onChange={(event) => this.handleChange(event)} />
                          <span className="pure-form-message-inline">Local transaction id for POS. This must be unique for the POS.</span>
                        </div>}
                      {advancedRequestOptions &&
                        <div className="pure-control-group">
                          <label htmlFor="requiredScope">Required scope</label>
                          <input
                            className="pure-input-3-4"
                            name="requiredScope"
                            type="text"
                            id="requiredScope"
                            value={requiredScope}
                            onChange={(event) => this.handleChange(event)} />
                          <span className="pure-form-message-inline">Set this field to ask for data from the user together with the payment request.</span>
                        </div>}
                      <div className="pure-control-group">
                        <div className="pure-control-group button-group">
                          {!loadingShortlink && <button className="pure-button" type="button" onClick={(event) => this.handlePrevious(event)}>Previous</button>}
                          {!loadingPaymentRequest &&
                            <button
                              className="pure-button pure-button-primary"
                              disabled={((isDemoQRShortlinkSingle || isDemoQRShortlinkReuse) && !shortlinkId)}
                              type="button" onClick={(event) => this.handleStartDemo(event)}>
                              Start demo
                          </button>}
                          {loadingPaymentRequest && <div className="loader"></div>}
                        </div>
                      </div>
                    </div>
                  </div>}

                {step === steps.ORDER &&
                  <div className="box">
                    <div className="pure-control-group">
                      <h2>Order</h2>
                    </div>
                    <div className="pure-control-group">
                      <p>POS ID: <strong>{posId}</strong></p>
                      <p>Order ID: <strong>{posTid}</strong></p>
                      <p>Settle TID: <strong>{currentTransactionId}</strong></p>
                      <p>Cost: <strong>{amount / 100} {currency}</strong></p>
                      {isDemoPhonenumber && <p><strong>Sent to:</strong> {phonenumber}</p>}
                      <pre>{message}</pre>
                      {isDemoQRShortlinkReuse && <button className="pure-button" type="button" disabled={currentTransactionId} onClick={(event) => this.createNewOrder(event)}>Generate new order</button>}
                      <p>Status: {lastStatusMessage}</p>
                    </div>

                    {!(isDemoPhonenumber || isDemoQRPaymentlink) &&
                      <aside className="warn-block">
                        <h3>Manual handling</h3>
                        <p>Without a callback server, we can't detect the scan and create a request, but we can emulate this by manually creating a payment request for the shortlink.</p>
                        <div className="pure-control-group button-group">
                          <button className="pure-button" type="button" disabled={currentTransactionId} onClick={(event) => this.handleCreatePaymentRequest(event)}>Create request</button>
                          <button className="pure-button pure-button-danger" type="button" disabled={!currentTransactionId} onClick={(event) => this.handleAbort(event)}>Abort request</button>
                        </div><div className="pure-control-group button-group">
                          <button className="pure-button" type="button" disabled={!currentTransactionId} onClick={(event) => this.handleCapture(event)}>Capture payment</button>
                          <button className="pure-button" type="button" disabled={!currentTransactionId} onClick={(event) => this.handleRelease(event)}>Release payment</button>
                        </div>

                        <div className="pure-control-group">
                          <label htmlFor="autoCapture" className="pure-checkbox">
                            <input
                              type="checkbox"
                              name="autoCapture"
                              id="autoCapture"
                              value="autoCapture"
                              checked={autoCapture}
                              onChange={(event) => this.handleChange(event)} />
                          &nbsp;&nbsp;Auto capture
                        </label>
                          <span className="pure-form-message-inline">
                            Capture authorized payments automatically.
                            If not set, manual capture needs to happen within 72 hours,
                            else the auth will expire and the money will be refunded.
                        </span>
                        </div>
                      </aside>}

                    {!isDemoPhonenumber &&
                      <aside className="info-block">
                        <p>Acceptance URL: <br /><em>{acceptanceUrl}</em></p>
                        <canvas id="qr"></canvas>
                        <p><a href={mobileFriendlyURL}>Mobile friendly URL ({environment})</a></p>
                        <p><em>Use this link when on a mobile device. Typically hidden for desktop users in production systems.</em></p>
                        <p></p>
                      </aside>}

                    <div className="pure-control-group button-group">

                      {!currentTransactionId && <button className="pure-button pure-button-primary" type="button" onClick={(event) => this.handleStopDemo(event)}>Close</button>}
                      {currentTransactionId && <button className="pure-button" type="button" onClick={(event) => this.handleStopDemo(event)}>Close</button>}
                    </div>
                  </div>}
              </div>
            </div>


            {step === steps.DEMO &&
              <div className="pure-u-1 pure-u-md-1-2 pure-u-lg-3-3">

                <div className="box">

                  <div>
                    <h3>Phone number</h3>
                    <p>Send payment request directly to the customer device when POS have access to customer data (or can easily accept phone number as input from customer).</p>
                    <ol>
                      <li>POS creates local order with unique id.</li>
                      <li>POS creates payment request for customer phone number.</li>
                      <li>Settle pushes payment request to the customer.</li>
                      <li>Settle calls back to POS with outcome.</li>
                    </ol>
                    <p><em>Example:</em> Vending machine, web-shop, recurring payments</p>
                  </div>

                  <div>
                    <h3>Paymentlink</h3>
                    <p>Create payment request to be claimed by user later.</p>
                    <ol>
                      <li>POS creates local order with unique id.</li>
                      <li>POS creates payment request.</li>
                      <li>POS creates unique Paymentlink QR code.</li>
                      <li>Customer scans QR code.</li>
                      <li>Settle pushes payment request to the customer.</li>
                      <li>Settle calls back to POS with outcome.</li>
                    </ol>
                    <p><em>Example:</em> Modern cash registers, mobile pos, card terminals, web-shops.</p>
                  </div>

                  <div>
                    <h3>Shortlink (reusable)</h3>
                    <p>Payment request sent when a user interacts with a reusable Shortlink QR code that was created during POS setup.</p>
                    <ol>
                      <li>Setup: POS creates Shortlink.</li>
                      <li>Setup: POS creates Shortlink QR code*.</li>
                      <li>Customer scans reusable Shortlink QR code.</li>
                      <li>Settle calls back to POS with customer identifier.</li>
                      <li>POS creates payment request for customer identifier.</li>
                      <li>Settle pushes payment request to the customer.</li>
                      <li>Settle calls back to POS with outcome.</li>
                    </ol>
                    <p>When a payment request have been resolved (accepted, rejected, or cancelled*) the Shortlink can be reused.</p>
                    <p><em>Example:</em> POS device without customer facing display, requiring pre-printed QR code.</p>
                  </div>

                  <div>
                    <h3>Shortlink (single use)</h3>
                    <p>QR created when POS device is turned on or registered. The local id is passed along by Settle and can be picked up by centralised middleware to understand what POS device and purchase the request originated from.</p>
                    <p>Customer scan the QR code, claiming the last Payment Request associated with the Shortlink. When PR have been successful, rejected, or cancelled, the SL is freed up and ready to be associated with a new Payment Request.</p>
                    <p><em>Example:</em> Card terminals.</p>
                  </div>

                </div>
              </div>}

            {step >= steps.SHORTLINK && <>
              <div className="pure-u-1 pure-u-md-1-2 pure-u-lg-1-3">

                <div className="box">
                  <h2>Status log</h2>
                  <div>{statusLog.map(({ id, message }) =>
                    <div key={id} className="row">
                      <div className="pure-u-21-24">{message}</div>
                    </div>
                  )}</div>
                </div>
              </div>
              <div className="pure-u-1 pure-u-md-1-2 pure-u-lg-1-3">
                <div className="box">
                  <h2>API request log {loaderRequest && <div className="loader loader-small" ></div>}</h2>
                  <div className="status">{apiLog.map(({ id, method, endpoint, body, status, duplicates }) =>
                    <div key={id} className="row pure-g">
                      <div className="pure-u-2-24">{duplicates > 0 && <span className="label">{duplicates}</span>}</div>
                      <div className="pure-u-22-24"><strong>{method}</strong> {status && `${status} `}{endpoint}</div>
                    </div>
                  )}
                  </div>
                </div>
              </div>
            </>}

          </div>
        </div>
      </main>
    );
  }
}

export default App;
