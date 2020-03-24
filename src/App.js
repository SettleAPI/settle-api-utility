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
  PAYMENT_REQUEST: 2,
  SCAN: 3,
}

// return last value, or default if not found in local storage
function getInitial(name, defaultValue) {
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
function setInitial(name, value) {
  localStorage.setItem(`settle-api-utility.config.${name}`, value);
}

class App extends React.Component {

  constructor(props) {
    super(props);
    const products = settle.getFakeProducts();

    this.state = {
      environment: getInitial('environment', 'sandbox'),
      merchantId: getInitial('merchantId', settle.configs['sandbox'].testMerchantId),
      userId: getInitial('userId', settle.configs['sandbox'].testUserId),
      secret: getInitial('secret', settle.configs['sandbox'].testSecret),
      shortlinkId: null,
      shortlinkIdWithCallback: null,
      shortlinkIdWithNoCallback: null,
      callbackUri: getInitial('callbackUri', ''),
      step: steps.CREDENTIALS,
      loadingCredentials: false,
      loadingFlow: false,
      loadingShortlink: false,
      loadingPaymentRequest: false,
      loadingScan: false,
      isScanned: false,
      method: getInitial('method', 'scan'),
      flow: getInitial('flow', 'polling'),
      phonenumber: getInitial('phonenumber', ''),
      autoCapture: getInitial('autoCapture', true),
      advancedRequestOptions: getInitial('advancedRequestOptions', false),
      amount: products.total,
      additionalAmount: getInitial('additionalAmount', 0),
      additionalEdit: getInitial('additionalEdit', false),
      allowCredit: getInitial('allowCredit', true),
      currency: getInitial('currency', 'NOK'),
      customer: getInitial('method', 'scan') === 'phone' ? `msisdn:${getInitial('phonenumber', '')}` : getInitial('customer', ''),
      action: getInitial('action', 'SALE'),
      posTid: short.generate(),
      posId: getInitial('posId', 'abc123'),
      requiredScope: getInitial('requiredScope', ''),
      message: products.list,
      statusLog: [],
      apiLog: [],
      loaderRequest: false,
    }

    this.handleChange = this.handleChange.bind(this);
    this.handleCredentials = this.handleCredentials.bind(this);
    this.handleCreateShortlink = this.handleCreateShortlink.bind(this);
  }

  async doRequest(method, endpoint, body) {
    console.log(`Making a ${method} request to ${endpoint}`, body);
    const { environment, merchantId, userId, secret } = this.state;
    this.setState({ loadingRequest: true })
    this.addAPILogEntry(method, endpoint, body)
    const response = await settle.doRequest(method, `/${environment}${endpoint}`, {
      merchantId,
      userId,
      secret,
    }, body)
    this.setState({ loadingRequest: false })
    return response
  };

  resetPayment() {
    // Reset QR code
    const canvas = document.getElementById('qr');
    // eslint-disable-next-line no-self-assign
    if (canvas) canvas.width = canvas.width // quick and dirty reset of QR canvas

    // insert blank as delimeter
    this.addLogEntry('')
    this.addAPILogEntry('')

    const products = settle.getFakeProducts();
    console.log(products)
    // reset payment state
    this.setState({
      loadingPaymentRequest: false,
      currentTransactionId: null,
      posTid: short.generate(),
      acceptanceUrl: '',
      isScanned: false,
      step: steps.PAYMENT_REQUEST,
      amount: products.total,
      message: products.list,
    });
  }

  renderQRCode(acceptanceUrl) {
    this.setState({ acceptanceUrl }, () => {
      new qr({
        element: document.getElementById('qr'),
        value: acceptanceUrl,
        size: 300,
      })
    })
  }

  handleChange(event) {
    const target = event.target;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    const name = target.name;

    this.setState({
      [name]: value
    });

    setInitial(name, value);

    if (name === 'callbackUri') {
      this.setState({ shortlinkIdWithCallback: '' })
    }

    if (name === 'phonenumber') {
      this.setState({ customer: `msisdn:${value}` })
    }

    if (name === 'method' && value === 'phone') {
      this.setState({ customer: `msisdn:${this.state.phonenumber}` })
    }

    if (name === 'method' && value === 'scan') {
      if (this.isFlowPolling()) {
        this.setState({
          customer: `shortlink_id:${this.state.shortlinkIdWithNoCallback}`
        })
      } else {
        this.setState({
          customer: ``
        })
      }
    }

    if (name === 'flow' && value === 'callback') {
      this.setState({
        shortlinkId: this.state.shortlinkIdWithCallback,
        customer: ''
      })
    }

    if (name === 'flow' && value === 'polling') {
      this.setState({
        shortlinkId: this.state.shortlinkIdWithNoCallback,
        customer: `shortlink_id:${this.state.shortlinkIdWithNoCallback}`
      })
    }
  }

  capturePayment(tid) {
    this.doRequest('PUT', `/merchant/v1/payment_request/${tid}/`, { 'action': 'capture' });
  }

  handleCapture() {
    const { currentTransactionId } = this.state;
    this.capturePayment(currentTransactionId);
  }

  async handleCredentials(event) {
    this.setState({ loadingCredentials: true });
    const userId = this.state.userId;
    try {
      const { data } = await this.doRequest('GET', `/merchant/v1/api_key/${userId}/`, '')
      console.log('data', data)
      this.setState({
        loadingCredentials: false,
        step: 2,
        isValid: true,
        credStatus: `Credentials are valid. API user key labeled "${data.label}"`
      })
      this.addLogEntry('Credentialis validated');
      this.getOrCreateShortlink();

    } catch (error) {
      this.setState({
        loadingCredentials: false,
        credStatus: `Credentials are invalid. ${error.message}`
      })
    }
  }

  handleCreateShortlink(event) {
    this.getOrCreateShortlink()
  }

  handleClear(event) {
    this.setState({
      merchantId: '',
      userId: '',
      secret: '',
      credStatus: '',
    })
  }

  handleCancel(event) {
    this.addLogEntry('Canceled');
    this.resetPayment();
  }

  addLogEntry(message) {
    const { statusLog } = this.state
    if (message !== this.state.lastStatusMessage) {
      statusLog.push({ id: statusLog.length, message });
    }
    this.setState({ statusLog, lastStatusMessage: message })
  };

  addAPILogEntry(method, endpoint, bodyObject) {
    const body = JSON.stringify(bodyObject)
    let { apiLog } = this.state
    if (apiLog.length > 0) {
      const previous = apiLog[apiLog.length - 1]
      const isMatching = previous.method === method
        && previous.endpoint === endpoint
        && previous.body === body

      if (isMatching) {
        apiLog[apiLog.length - 1].duplicates = previous.duplicates + 1
        return;
      }
    }
    apiLog.push({ id: apiLog.length, method, endpoint, body, duplicates: 0 });
    this.setState({ apiLog })
  };

  async checkOutcome() {
    const { currentTransactionId, autoCapture, isScanned } = this.state;

    if (!currentTransactionId)
      return;

    try {
      const response = await this.doRequest('GET', `/merchant/v1/payment_request/${currentTransactionId}/outcome/`);
      const { status_code, customer } = response.data;

      if (!isScanned && customer.includes('token')) {
        this.addLogEntry('Customer scanned QR code')
        this.setState({ isScanned: true })
      }

      this.addLogEntry(settle.outcomeDescriptions[status_code])
      if (status_code === settle.statusCodes.PENDING) {
        setTimeout(() => this.checkOutcome(), 1000);
        return;
      }
      if (status_code === settle.statusCodes.AUTH) {
        console.log('Auto capture:', autoCapture)
        if (autoCapture) {
          console.log('Auto capture!')
          this.capturePayment(currentTransactionId);
        }
        setTimeout(() => this.checkOutcome(), 1000);
        return;
      }
    } catch (error) {
      setTimeout(() => this.checkOutcome(), 1000);
      return;
    }

    this.setState({ currentTransactionId: null })
    this.resetPayment()
  };

  isFlowCallback() {
    return this.state.flow === "callback";
  };

  isFlowPolling() {
    return this.state.flow === "polling";
  };

  isMethodScan() {
    return this.state.method === "scan";
  };

  isMethodPhone() {
    return this.state.method === "phone";
  };

  async createMissingLinks() {
    if (!this.state.shortlinkIdWithCallback) {
      console.log('creating link with callback');
      this.addLogEntry('Creating link with callback');
      try {
        const response = await this.doRequest('POST', '/merchant/v1/shortlink/', { 'callback_uri': this.state.callbackUri })
        const link = response.data
        console.log('created', link.id, 'with callback');
        this.setState({
          shortlinkIdWithCallback: link.id,
          customer: this.isFlowPolling() ? `shortlink_id:${link.id}` : ''
        });
      } catch (error) {
        console.warn('Could not create link:', error.message)
      }
    }
    if (!this.state.shortlinkIdWithNoCallback) {
      try {
        const response = await this.doRequest('POST', '/merchant/v1/shortlink/', { 'callback_uri': null })
        const link = response.data
        console.log('created', link.id, 'without callback');
        this.setState({
          shortlinkIdWithNoCallback: link.id,
        })
      } catch (error) {
        console.warn('Could not create link:', error.message)
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
    } = this.state;

    let body = {
      'action': action,
      'amount': parseInt(amount),
      'additional_amount': parseInt(additionalAmount),
      'additional_edit': additionalEdit,
      'allow_credit': allowCredit,
      'currency': currency,
      'text': message,
      'customer': customer,
      'pos_id': posId,
      'pos_tid': posTid,
      'required_scope': requiredScope,
      // 'callback_uri': callbackUri,
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
    if (requiredScope !== '') {
      body.requiredScope = requiredScope
    }

    this.addLogEntry('Creating payment request')
    let response;
    try {
      response = await this.doRequest('POST', '/merchant/v1/payment_request/', body)
    } catch (error) {
      console.error('payment_request error', error, error.response)
      let message;
      if (error.response.status === 400) {
        message = `${error.response.statusText}. ${error.response.data.error_description}`
      }
      else {
        message = error.message
      }
      this.addLogEntry(message)
      return;
    }
    console.log('response: ' + response.data.status_code, response)
    return response.data.id
  }


  getAcceptanceUrl(transactionId) {
    console.log('getAcceptanceUrl', transactionId)
    let shortlinkId;
    if (this.isFlowCallback()) {
      if (!this.state.shortlinkIdWithCallback) {
        throw Error("Unable to get or create shortlink");
      }
      shortlinkId = this.state.shortlinkIdWithCallback;
    } else {
      shortlinkId = this.state.shortlinkIdWithNoCallback;
    }
    return `http://settle.eu/s/${shortlinkId}/${transactionId}`
  };


  async handleCreatePaymentRequest() {
    this.setState({
      loadingPaymentRequest: true,
    })
    let tid = short.generate();

    if (this.isFlowPolling() || this.isMethodPhone()) {
      try {
        tid = await this.createPaymentRequest();
      } catch (error) {
        console.error(error.message)
        this.addLogEntry(`Error: ${error.message}`)
        this.resetPayment();
        return;
      }
    }

    if (this.isMethodScan()) {
      var acceptanceUrl = this.getAcceptanceUrl(tid);
      console.log('transaction.id', tid)
      console.log('acceptanceUrl: ', acceptanceUrl)
    }

    this.setState({
      loadingPaymentRequest: false,
      currentTransactionId: tid,
      step: steps.SCAN
    }, () => {
      if (this.isMethodScan()) this.renderQRCode(acceptanceUrl);
      this.checkOutcome();
    })
  }

  async getLink(uri) {
    var parts = uri.split('/'),
      linkId = parts[parts.length - 2];

    const response = await this.doRequest('GET', `/merchant/v1/shortlink/${linkId}/`, {});
    const link = response.data
    console.log('callback', link.id, link.callback_uri)
    if (!link.callback_uri && !this.state.shortlinkIdWithNoCallback) {
      this.setState({
        shortlinkIdWithNoCallback: link.id,
        customer: this.isFlowPolling() ? `shortlink_id:${link.id}` : ''
      })
      this.addLogEntry(`Using link ${link.id} for polling flow`)
      console.log(`Using link ${link.id} for polling flow`);
    } else {
      if (link.callback_uri === this.state.callbackUri) {
        this.setState({ shortlinkIdWithCallback: link.id, })
        this.addLogEntry(`Using link ${link.id} for callback flow`, link.callback_uri);
        console.log(`using link ${link.id} for callback flow`, link.callback_uri);
      }
    }
  };

  async getOrCreateShortlink() {
    try {
      this.setState({ loadingShortlink: true })
      const response = await this.doRequest('GET', '/merchant/v1/shortlink/', {});
      const uris = response.data.uris
      const deferreds = uris.map((uri) => this.getLink(uri));
      this.addLogEntry('Analysing existing shortlinks')

      Promise.all(deferreds).then(results => {
        try {
          this.createMissingLinks();
        } catch (error) {
          console.error(error.message)
          this.addLogEntry(error.message)
        }
        this.setState({
          loadingShortlink: false,
          step: steps.PAYMENT_REQUEST
        });
      });

    } catch (error) {
      console.error(error)
      this.addLogEntry(error.message)
    }
  };

  render() {
    const {
      step,
      posId,
      posTid,
      amount,
      userId,
      secret,
      action,
      apiLog,
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
      message,
      additionalAmount,
      loadingShortlink,
      loadingCredentials,
      loadingPaymentRequest,
      advancedRequestOptions,
      shortlinkIdWithCallback,
      shortlinkIdWithNoCallback,
    } = this.state

    const isMethodPhone = this.isMethodPhone();
    const isMethodScan = this.isMethodScan();
    const isFlowCallback = this.isFlowCallback();
    const isFlowPolling = this.isFlowPolling();
    const mobileFriendlyURL = settle.getDeepLink(acceptanceUrl, environment);
    const shortlinkId = isFlowCallback ? shortlinkIdWithCallback : shortlinkIdWithNoCallback
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
                  onChange={this.handleChange} >
                  <option>sandbox</option>
                  <option>production</option>
                </select>
              </div>
            </div>
          </div>
        </header>

        <div className="content">
          <h1>Payment flow demo</h1>
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
                        onChange={this.handleChange} />
                    </div>
                    <div className="pure-control-group">
                      <label>User ID</label>
                      <input name="userId"
                        type="text"
                        value={userId}
                        onChange={this.handleChange} />
                    </div>
                    <div className="pure-control-group">
                      <label>Secret</label>
                      <input name="secret"
                        type="text"
                        value={secret}
                        onChange={this.handleChange} />
                    </div>
                    {!loadingCredentials && <div className="pure-control-group button-group">
                      <button className="pure-button pure-button-primary" type="button" onClick={(event) => this.handleCredentials(event)}>Use credentials</button>
                      <button className="pure-button" type="button" onClick={(event) => this.handleClear(event)}>Clear</button>
                    </div>}
                    <div id="credential-status">
                      {loadingCredentials && <div className="loader"></div>}
                      <p>{credStatus}</p>
                    </div>
                  </div>}

                {false &&
                  <div className="box">
                    <h2>Create shortlink</h2>
                    <div>
                      <p>To be able to receive scans, one must first register a shortlink which we will than encode to a QR code.</p>
                      <p>Shortlinks can be reused so we will first try to retrive any current links for this merchant.</p>
                      <p>Otherwise, we'll just create a new one.</p>
                      <div className="pure-control-group button-group">
                        {!loadingShortlink && <button className="pure-button pure-button-primary" type="button" onClick={(event) => this.handleCreateShortlink(event)}>Get shortlink</button>}
                        {loadingShortlink && <div className="loader"></div>}
                      </div>
                    </div>
                  </div>}

                {step === steps.PAYMENT_REQUEST &&
                  <div className="box">
                    <h2>Create payment request</h2>
                    <div className="container" id="transaction">
                      <p>After being associated with a payment request, the customer can either reject or authorize. An authorization is valid for 3 days, but can be reauthorized before it expires to be valid for 3 new days. Once authorized, it can be captured to be included in the next settlement.</p>
                      <p>As a payment request goes through several stages, we'll poll to follow along the changes.</p>

                      <h3>Method</h3>
                      <div className="pure-control-group">
                        <label htmlFor="scan" className="pure-radio">
                          <input
                            type="radio"
                            name="method"
                            id="scan"
                            value="scan"
                            checked={isMethodScan}
                            onChange={this.handleChange} />
                          &nbsp;&nbsp;QR Code / Deeplink
                        </label>
                        <span className="pure-form-message-inline">Customer scans QR code with the Settle App or clicks mobile deeplink</span>
                      </div>

                      <div className="pure-control-group">
                        <label htmlFor="phone" className="pure-radio">
                          <input
                            type="radio"
                            name="method"
                            id="phone"
                            value="phone"
                            checked={isMethodPhone}
                            onChange={this.handleChange} />
                          &nbsp;&nbsp;Phonenumber
                        </label>
                        <span className="pure-form-message-inline">Customer gets payment request directly in the Settle App</span>
                      </div>

                      {isMethodPhone && <div className="pure-control-group">
                        <label htmlFor="callbackUri">Recipient phone number</label>
                        <input
                          className="pure-input-2-5"
                          name="phonenumber"
                          type="text"
                          id="phonenumber"
                          value={phonenumber}
                          onChange={this.handleChange} />
                        <span className="pure-form-message-inline">Needs to be an MSISDN</span>
                      </div>}



                      <h3>Test options</h3>
                      <div className="pure-control-group">
                        <label htmlFor="polling" className="pure-radio">
                          <input
                            type="radio"
                            name="flow"
                            id="polling"
                            value="polling"
                            checked={isFlowPolling}
                            onChange={this.handleChange} />
                          &nbsp;&nbsp;Polling flow
                        </label>
                        <span className="pure-form-message-inline">Create a payment request with the shortlink as customer, letting the Settle backed make the connection to whoever interacts with the shortlink. Poll for changes.</span>
                      </div>

                      <div className="pure-control-group">
                        <label htmlFor="callback" className="pure-radio">
                          <input
                            type="radio"
                            name="flow"
                            id="callback"
                            value="callback"
                            checked={isFlowCallback}
                            onChange={this.handleChange} />
                          &nbsp;&nbsp;Callback flow
                        </label>
                        <span className="pure-form-message-inline">Wait for callback from the Settle backend before creating the payment request, using the received "scan token"</span>
                      </div>

                      {isFlowCallback && <div className="pure-control-group">
                        <label htmlFor="callbackUri">Callback URI</label>
                        <input
                          className="pure-input-1"
                          name="callbackUri"
                          type="text"
                          id="callbackUri"
                          value={callbackUri}
                          onChange={this.handleChange} />
                        <span className="pure-form-message-inline">URI for server handling callbacks</span>
                      </div>}

                      <div className="pure-control-group">
                        <label htmlFor="autoCapture" className="pure-checkbox">
                          <input
                            type="checkbox"
                            name="autoCapture"
                            id="autoCapture"
                            value="autoCapture"
                            checked={autoCapture}
                            onChange={this.handleChange} />
                          &nbsp;&nbsp;Auto capture
                        </label>
                        <span className="pure-form-message-inline">Capture authorized payments automatically. If not set, capture needs to be done in the order view within 72 hours, else the auth will expire and the money will be refunded.</span>
                      </div>

                      <div className="pure-control-group">
                        <label htmlFor="advancedRequestOptions" className="pure-checkbox">
                          <input
                            type="checkbox"
                            name="advancedRequestOptions"
                            id="advancedRequestOptions"
                            value="advancedRequestOptions"
                            checked={advancedRequestOptions}
                            onChange={this.handleChange} />
                          &nbsp;&nbsp;Advanced options
                        </label>
                        <span className="pure-form-message-inline">Unlocks advanced payment request options below</span>
                      </div>

                      {this.isMethodScan() && <>
                        <h3>Shortlink ID in use</h3>
                        <div className="pure-control-group button-group">
                          {!loadingShortlink && !shortlinkId && <button className="pure-button pure-button-primary" type="button" onClick={(event) => this.handleCreateShortlink(event)}>Get shortlink</button>}
                          {loadingShortlink && <div className="loader"></div>}
                        </div>
                        <span>{shortlinkId}</span></>}


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
                            onChange={this.handleChange} />
                        </div>}
                      <div className="pure-control-group">
                        <label htmlFor="amount">Amount (in cents)</label>
                        <input
                          className="pure-input-1-4"
                          name="amount"
                          type="number"
                          id="amount"
                          value={amount}
                          onChange={this.handleChange} />
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
                            onChange={this.handleChange} />
                          <span className="pure-form-message-inline">Typically a cash withdrawal or gratuity</span>
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
                              onChange={this.handleChange} />
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
                              onChange={this.handleChange} />
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
                            onChange={this.handleChange} />
                          <span className="pure-form-message-inline">Three (3) chars following <a href="https://en.wikipedia.org/wiki/ISO_4217">ISO 4217</a></span>
                        </div>}
                      <div className="pure-control-group">
                        <label htmlFor="message">Message</label>
                        <textarea
                          className="pure-input-1"
                          name="message"
                          type="text"
                          id="message"
                          rows="4"
                          value={message}
                          onChange={this.handleChange} ></textarea>
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
                            onChange={this.handleChange}
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
                            onChange={this.handleChange} />
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
                            onChange={this.handleChange} />
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
                            onChange={this.handleChange} />
                          <span className="pure-form-message-inline">Set this field to ask for data from the user together with the payment request.</span>
                        </div>}
                      <div className="pure-control-group">
                        <div className="pure-control-group button-group">
                          {!loadingPaymentRequest && isMethodPhone &&
                            <button
                              className="pure-button pure-button-primary"
                              type="button" onClick={(event) => this.handleCreatePaymentRequest(event)}>
                              Send request
                            </button>}
                          {!loadingPaymentRequest && isMethodScan &&
                            <button
                              className="pure-button pure-button-primary"
                              disabled={!shortlinkId}
                              type="button" onClick={(event) => this.handleCreatePaymentRequest(event)}>
                              Create
                          </button>}
                          {loadingPaymentRequest && <div className="loader"></div>}
                        </div>
                      </div>
                    </div>
                  </div>}

                {step === steps.SCAN &&
                  <div className="box">
                    <h2>{isMethodScan ? 'Scan QR code' : 'Request sent'}</h2>
                    <div className="pure-control-group">
                      <div className="col-sm">
                        <p>Encoded shortlik:</p><p><span id="acceptanceURL">{acceptanceUrl}</span></p>
                      </div>
                      <div className="col-sm">
                        <canvas id="qr"></canvas>
                      </div>
                      {isMethodScan && <><p>Use this when on a mobile device:</p><p><a href={mobileFriendlyURL}>Mobile acceptance deeplink</a></p></>}
                    </div>
                    <div className="pure-control-group">
                      <div className="pure-control-group button-group">
                        {!autoCapture && <button className="pure-button pure-button-primary" type="button" onClick={(event) => this.handleCapture(event)}>Capture payment</button>}
                        <button className="pure-button " type="button" onClick={(event) => this.handleCancel(event)}>Cancel</button>
                      </div>
                    </div>
                  </div>}
              </div>
            </div>

            <div className="pure-u-1 pure-u-md-1-2 pure-u-lg-1-3">
              {step !== steps.CREDENTIALS &&
                <div className="box">
                  <h2>Status log</h2>
                  <div id="status">{statusLog.map(({ id, message }) =>
                    <div key={id} className="row">
                      <div className="pure-u-21-24">{message}</div>
                    </div>
                  )}</div>
                </div>}
            </div>
            <div className="pure-u-1 pure-u-md-1-2 pure-u-lg-1-3">
              {step !== steps.CREDENTIALS &&
                <div className="box">
                  <h2>API request log {loaderRequest && <div className="loader loader-small" ></div>}</h2>
                  <pre id="status">{apiLog.map(({ id, method, endpoint, body, duplicates }) =>
                    <div key={id} className="row pure-g">
                      <div className="pure-u-2-24">{duplicates > 0 && <span className="label">{duplicates}</span>}</div>
                      <div className="pure-u-22-24"><strong>{method}</strong> {endpoint}</div>
                    </div>
                  )}
                  </pre>
                </div>}
            </div>

          </div>
        </div>
      </main>
    );
  }
}

export default App;
