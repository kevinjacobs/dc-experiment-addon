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
  },

  rememberBoolPref(name) {
    const kPrefPrefix = "dc-experiment.previous.";
    let curMode = Services.prefs.getBoolPref(name);
    // eslint-disable-next-line no-console
    // console.log("Saving current " + name + " pref: " + curMode);
    Services.prefs.setBoolPref(kPrefPrefix + name, curMode);
  },

  restoreBoolPref(name) {
    const kPrefPrefix = "dc-experiment.previous.";
    let prevMode = Services.prefs.getBoolPref(kPrefPrefix + name);
    // eslint-disable-next-line no-console
    // console.log("Restoring " + kPrefPrefix + name + ": " + prevMode);
    Services.prefs.setBoolPref(name, prevMode);
  },
};

/* Submit the result for telemetry, and return true if successful.
 * If the telemetry submission was unsuccessful OR the result itself
 * indicates that we should retry the experiment, return false. */
function recordResult(result) {
  if (result.status === 521 || !result.hasResult) {
    // 521 result means we could reach CF, but CF could not reach the host. In this case,
    // mark the experiment as not-run, allowing it run again.
    return false;
  }
  // eslint-disable-next-line no-console
  console.log(result); //TODO: Do the telemetry submission...
  return true;
}

/* Record one of the following for telemetry:
 * |success|: Connected successfully using a delegated credential.
 * |handshake_not_delegated|: Connected successfully, but did not negotiate using delegated credential.
 * |certificate_not_delegated|: Connected successfully, but the certificate did not permit delegated credentials.     <======= TODO: How to interrogate the EE Cert?
 * |timed_out|: Network timeout.
 * |dns_failure|: Failed to connect due to a DNS failure.
 * |network_failure|: Failed to connect due to a non-timeout, non-dns network error (connection reset, etc).
 * |insufficient_security|: The delegated credential did not provide high enough security.
 * |incorrect_tls_version|: Connected successfully, but used TLS < 1.3.
*/
function populateResult(channel, result) {
  let secInfo = channel.securityInfo;
  if (secInfo instanceof Ci.nsITransportSecurityInfo) {
    secInfo.QueryInterface(Ci.nsITransportSecurityInfo);
    let isSecure = (secInfo.securityState & Ci.nsIWebProgressListener.STATE_IS_SECURE) == Ci.nsIWebProgressListener.STATE_IS_SECURE;

    if (result.status >= 400 && result.status <= 521) { // HTTP Error codes
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
    else if (secInfo.isDelegatedCredential) {
      result.telemetryResult = kResults.INSUFFICIENT_SECURITY;
    }

    result.hasResult = true;
  }
}

function finishExperiment(result) {
  // Revert the DC setting
  prefManager.restoreBoolPref(kDelegatedCredentialsPref);

  if (result.hasResult && recordResult(result)) {
    // Mark the experiment as completed.
    Services.prefs.setBoolPref("dc-experiment.hasRun", true);
    return;
  }
}

function makeRequest(branch) {
  var result = {
    "branch" : branch,
    "hasResult" : false // True when we have something worth reporting
  };

  var oReq = new XMLHttpRequest();
  oReq.open("HEAD", "https://" + kDelegatedCredentialsHost);
  oReq.setRequestHeader("X-Firefox-Experiment", "Delegated Credentials Breakage #1; https://bugzilla.mozilla.org/show_bug.cgi?id=1582591");
  oReq.timeout = 30000;
  oReq.addEventListener("error", e => {
    e.target.QueryInterface(Ci.nsIHttpChannel);
    let channel = e.target.channel;
    let nsireq = channel.QueryInterface(Ci.nsIRequest);
    result.nsiReqError = nsireq ? nsireq.status : Cr.NS_ERROR_NOT_AVAILABLE;
    populateResult(channel, result);
    finishExperiment(result);
  });
  oReq.addEventListener("load", e => {
    //e.target.QueryInterface(Ci.nsIHttpChannel);
    result.status = e.target.status;
    result.nsiReqError = Cr.NS_OK;
    populateResult(e.target.channel, result);
    finishExperiment(result);
  });
  oReq.addEventListener("timeout", () => {
    result.telemetryResult = kResults.TIMEOUT;
    result.hasResult = true;
    finishExperiment(result);
  });
  oReq.addEventListener("abort", () => {
    // !hasResult means we reattempt.
    finishExperiment(result);
  });

  oReq.send();
}

// Returns true iff this session will perform the test.
function getEnrollmentStatus() {
  let val = Services.prefs.getBoolPref("dc-experiment.hasRun", false);
  if (val != null && val === true) {
    // The user has already run this experiment.
    return false;
  }

  //return Math.random() >= 0.02;
  return true; // TODO: Be more selective...
}

// Returns true iff the test is to be performed with DC enabled.
function getDCTreatment() {
  return Math.random() >= 0.5;
}

const studyManager = {
  uninstall() {
    // TODO: How can we cleanup? https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/management is unsupported
    Services.prefs.clearUserPref("dc-experiment.hasRun");
    Services.prefs.clearUserPref("dc-experiment.previous." + kDelegatedCredentialsPref);
  },

  runTest() {
    // If the user has already changed the default setting or they are not randomly selected, return early.
    if (prefManager.prefHasUserValue(kDelegatedCredentialsPref) ||
        getEnrollmentStatus() === false) {
      return;
    }

    prefManager.rememberBoolPref(kDelegatedCredentialsPref);
    let testBranch = getDCTreatment() ? BRANCH_TREATMENT : BRANCH_CONTROL;

    if (testBranch === BRANCH_TREATMENT) {
      prefManager.setBoolPref(kDelegatedCredentialsPref, true);
    } else {
      prefManager.setBoolPref(kDelegatedCredentialsPref, false);
    }

    // Attempt the connection
    makeRequest(testBranch);
  }
};


var study = class study extends ExtensionAPI {
  getAPI() {
    return {
      experiments: {
        study: {
          runTest() {
            studyManager.runTest();
          },
          uninstall() {
            studyManager.uninstall();
          }
        },
      },
    };
  }
};
