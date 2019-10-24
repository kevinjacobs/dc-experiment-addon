"use strict";
/* exported study */
/* global Cc, Ci, Components, ExtensionAPI, Services  */

let Cu = Components.utils;
Cu.import("resource://gre/modules/ExtensionPreferencesManager.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.importGlobalProperties(["XMLHttpRequest"]);

const kDelegatedCredentialsHost = "kc2kdm.com";
const kDelegatedCredentialsPref = "security.tls.enable_delegated_credentials";
const kResults = {
  SUCCESS: 0,
  TIMEOUT: 1,
  SUCCESS_NO_DC: 2,
  CERT_NO_DC: 3,
  DNS_FAILURE: 4,
  NET_FAILURE: 5,
  INSUFFICIENT_SECURITY: 6,
  INCORRECT_TLS_VERSION: 7
};

// We can test via control (DC client-disable) or treatment (DC client-enable) branches.
const BRANCH_CONTROL = "control";
const BRANCH_TREATMENT = "treatment";

/* Prefs handlers */
const prefManager = {
  prefHasUserValue(name) {
    return Services.prefs.prefHasUserValue(name);
  },
  getPref(name, value) {
    let type = Services.prefs.getPrefType(name);
    switch (type) {
    case Services.prefs.PREF_STRING:
      return Services.prefs.getCharPref(name, value);
    case Services.prefs.PREF_INT:
      return Services.prefs.getIntPref(name, value);
    case Services.prefs.PREF_BOOL:
      return Services.prefs.getBoolPref(name, value);
    default:
      throw new Error("Unknown type");
    }
  },
  setBoolPref(name, value) {
    Services.prefs.setBoolPref(name, value);
  }
};


function recordResult(result) {
  // eslint-disable-next-line no-console
  console.log(result); //TODO: Do the telemetry thing...
}

/* Record one of the following for telemetry:
 * |success|: Connected successfully using a delegated credential.
 * |handshake_not_delegated|: Connected successfully, but did not negotiate using delegated credential.
 * |certificate_not_delegated|: Connected successfully, but the certificate did not permit delegated credentials.     <======= TODO: How to interrogate the EE Cert?
 * |timed_out|: Network timeout.
 * |dns_failure|: Failed to connect due to a DNS failure.
 * |network_failure|: Failed to connect due to a non-timeout, non-dns network error (connection reset, etc).
 * |insufficient_security|: The delegated credential did not provide high enough security.                            <======= TODO: DC-only, or all connections?
 * |incorrect_tls_version|: Connected successfully, but used TLS < 1.3.
*/
function populateResult(channel, result) {
  let secInfo = channel.securityInfo;
  if (secInfo instanceof Ci.nsITransportSecurityInfo) {
    secInfo.QueryInterface(Ci.nsITransportSecurityInfo);
    let isSecure = (secInfo.securityState & Ci.nsIWebProgressListener.STATE_IS_SECURE) == Ci.nsIWebProgressListener.STATE_IS_SECURE;

    if (result.status >= 400 && result.status <= 521) { //HTTP Error codes. Maybe we can do better...
      result.telemetryResult = kResults.NET_FAILURE;
    }
    else if (isSecure) {
      if (secInfo.protocolVersion < secInfo.TLS_VERSION_1_3) {
        result.telemetryResult = kResults.INCORRECT_TLS_VERSION;
      }
      else if (!secInfo.isDelegatedCredential) {
        result.telemetryResult = kResults.SUCCESS_NO_DC;
      }
      else if (secInfo.isDelegatedCredential) {
        result.telemetryResult = kResults.SUCCESS;
      }
    }
    else if (secInfo.isDelegatedCredential) { // TODO: Is this insufficient_security for only DC connections, or all?
      result.telemetryResult = kResults.INSUFFICIENT_SECURITY;
    }
  }
}

function makeRequest(branch, originalPrefVal) {
  var result = {
    "url" : "https://" + kDelegatedCredentialsHost,
    "branch" : branch
  };

  var oReq = new XMLHttpRequest();
  oReq.open("GET", "https://" + kDelegatedCredentialsHost);
  oReq.timeout = 30000;
  oReq.addEventListener("error", e => {
    e.target.QueryInterface(Ci.nsIHttpChannel);
    let channel = e.target.channel;
    let nsireq = channel.QueryInterface(Ci.nsIRequest);
    result.error = nsireq ? nsireq.status : Cr.NS_ERROR_NOT_AVAILABLE;
    populateResult(channel, result);
    recordResult(result);
    prefManager.setBoolPref(kDelegatedCredentialsPref, originalPrefVal);
  });
  oReq.addEventListener("load", e => {
    //e.target.QueryInterface(Ci.nsIHttpChannel);
    result.status = e.target.status;
    result.error = Cr.NS_OK;
    populateResult(e.target.channel, result);
    recordResult(result);
    prefManager.setBoolPref(kDelegatedCredentialsPref, originalPrefVal);
  });
  oReq.addEventListener("timeout", e => {
    result.telemetryResult = kResults.TIMEOUT;
    recordResult(result);
    prefManager.setBoolPref(kDelegatedCredentialsPref, originalPrefVal);
  });
  oReq.addEventListener("abort", e => {
    prefManager.setBoolPref(kDelegatedCredentialsPref, originalPrefVal);
  });

  oReq.send();
}

// Returns true iff this session will perform the test.
function getEnrollmentStatus() {
  return true; // TODO: Be more selective...
}

// Returns true iff the test is to be performed with DC enabled.
function getDCTreatment() {
  //return Math.random() >= 0.5;
  return true; // TODO: Be more selective...
}

const studyManager = {
  runTest() {
    // If the user has already changed the default setting or they are not randomly selected, return early.
    if (prefManager.prefHasUserValue(kDelegatedCredentialsPref) ||
        getEnrollmentStatus() === false) {
      return;
    }

    //TODO: How do we ensure the original setting is restored in the case of early shutdown/crash?
    let originalPrefVal = prefManager.getPref(kDelegatedCredentialsPref);
    let testBranch = getDCTreatment() ? BRANCH_TREATMENT : BRANCH_CONTROL;

    if (testBranch === BRANCH_TREATMENT) {
      //TODO: Enable DC (properly...?)
      prefManager.setBoolPref(kDelegatedCredentialsPref, true);
    } else {
      prefManager.setBoolPref(kDelegatedCredentialsPref, false);
    }

    // Attempt the connection
    makeRequest(testBranch, originalPrefVal);
  }
};


var study = class study extends ExtensionAPI {
  getAPI() {
    return {
      experiments: {
        study: {
          runTest() {
            studyManager.runTest();
          }
        },
      },
    };
  }
};
