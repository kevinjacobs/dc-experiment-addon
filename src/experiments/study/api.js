"use strict";

/* exported study */
/* global Cc, Ci, Components, ExtensionAPI, Services  */

let Cu = Components.utils;
Cu.import("resource://gre/modules/ExtensionPreferencesManager.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.importGlobalProperties(["XMLHttpRequest"]);

const kDelegatedCredentialsHost = "kc2kdm.com";
const kDelegatedCredentialsPref = "security.tls.enable_delegated_credentials";
const kTelemetryCategory = "delegatedcredentials"; // Can't have an underscore :(
const kBranchControl = "control";
const kBranchTreatment = "treatment";

const kTelemetryEvents = {
  "experiment": {
    methods: [ "connectDC", "connectNoDC" ],
    objects: [ "success", "timedOut", "hsNotDelegated", "certNotDelegated", "dnsFailure", "networkFailure", "insufficientSecurity", "incorrectTLSVersion" ]
  }
};

const kResults = {
  SUCCESS: "success",
  TIMEOUT: "timedOut",
  SUCCESS_NO_DC: "hsNotDelegated",
  CERT_NO_DC: "certificateNotDelegated",
  DNS_FAILURE: "dnsFailure",
  NET_FAILURE: "networkFailure",
  INSUFFICIENT_SECURITY: "insufficientSecurity",
  INCORRECT_TLS_VERSION: "incorrectTLSVersion"
};

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
    Services.prefs.setBoolPref(kPrefPrefix + name, curMode);
  },

  restoreBoolPref(name) {
    const kPrefPrefix = "dc-experiment.previous.";
    let prevMode = Services.prefs.getBoolPref(kPrefPrefix + name);
    Services.prefs.setBoolPref(name, prevMode);
    Services.prefs.clearUserPref("dc-experiment.previous." + kDelegatedCredentialsPref);
  },
};

function setResult(result, telemetryResult) {
  result.telemetryResult = telemetryResult;
  result.hasResult = true; // Report it and mark the experiment complete.
}

/* Record one of the following for telemetry:
 * |success|: Connected successfully using a delegated credential.
 * |handshakeNotDelegated|: Connected successfully, but did not negotiate using delegated credential.
 * |certificateNotDelegated|: Connected successfully, but the certificate did not permit delegated credentials.     <======= TODO: How to interrogate the EE Cert?
 * |timedOut|: Network timeout.
 * |dnsFailure|: Failed to connect due to a DNS failure.
 * |networkFailure|: Failed to connect due to a non-timeout, non-dns network error (connection reset, etc).
 * |insufficientSecurity|: The delegated credential did not provide high enough security.
 * |incorrectTLSVersion|: Connected successfully, but used TLS < 1.3. */
function populateResult(channel, result) {
  let secInfo = channel.securityInfo;
  if (secInfo instanceof Ci.nsITransportSecurityInfo) {
    secInfo.QueryInterface(Ci.nsITransportSecurityInfo);
    let isSecure = (secInfo.securityState & Ci.nsIWebProgressListener.STATE_IS_SECURE) == Ci.nsIWebProgressListener.STATE_IS_SECURE;

    if (result.status >= 400 && result.status < 521) {
      // HTTP Error codes indicating network error.
      setResult(result, kResults.NET_FAILURE);
      if(result.status == 408)
        setResult(result, kResults.TIMEOUT); // Except this one.
    }
    else if (result.status == 200 && isSecure) {
      if (secInfo.protocolVersion < secInfo.TLS_VERSION_1_3)
        setResult(result, kResults.INCORRECT_TLS_VERSION);
      else if (!secInfo.isDelegatedCredential)
        setResult(result, kResults.SUCCESS_NO_DC);
      else if (secInfo.isDelegatedCredential)
        setResult(result, kResults.SUCCESS);
    }
    else {
      const MOZILLA_PKIX_ERROR_INADEQUATE_KEY_SIZE = 2153398270;
      if (result.nsiReqError == MOZILLA_PKIX_ERROR_INADEQUATE_KEY_SIZE){
        setResult(result, kResults.INSUFFICIENT_SECURITY); // DC key strength was too weak
      }
    }
  }
  else {
    switch(result.nsiReqError) {
    case Cr.NS_ERROR_UNKNOWN_HOST:
      setResult(result, kResults.DNS_FAILURE);
      break;
    default:
      // Default to NET_FAILURE as there are many potential causes.
      setResult(result, kResults.NET_FAILURE);
      break;
    }
  }
  // The default is to leave hasResult unset and repeat the test.
}

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
  Services.telemetry.recordEvent(kTelemetryCategory, result.method, result.telemetryResult);
  return true;
}

function finishExperiment(result) {
  // Revert the DC setting
  prefManager.restoreBoolPref(kDelegatedCredentialsPref);

  if (result.hasResult && recordResult(result)) {
    // Mark the experiment as completed.
    Services.prefs.setBoolPref("dc-experiment.hasRun", true);
  }
}

function makeRequest(branch) {
  var result = {
    "method" : branch ==  kBranchControl ? "connectNoDC" : "connectDC",
    "hasResult" : false // True when we have something worth reporting
  };

  var oReq = new XMLHttpRequest();
  oReq.open("HEAD", "https://" + kDelegatedCredentialsHost);
  oReq.setRequestHeader("X-Firefox-Experiment", "Delegated Credentials Breakage #1; https://bugzilla.mozilla.org/show_bug.cgi?id=1582591");
  oReq.timeout = 30000;
  oReq.addEventListener("error", e => {
    let channel = e.target.channel;
    let nsireq = channel.QueryInterface(Ci.nsIRequest);
    result.nsiReqError = nsireq ? nsireq.status : Cr.NS_ERROR_NOT_AVAILABLE;
    populateResult(channel, result);
    finishExperiment(result);
  });
  oReq.addEventListener("load", e => {
    result.status = e.target.status;
    let nsireq = e.target.channel.QueryInterface(Ci.nsIRequest);
    result.nsiReqError = nsireq.status;
    populateResult(e.target.channel, result);
    finishExperiment(result);
  });
  oReq.addEventListener("timeout", () => {
    setResult(result, kResults.TIMEOUT);
    finishExperiment(result);
  });
  oReq.addEventListener("abort", () => {
    // Will retry
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
  return true; // TODO: Be more selective... If they are not in the cohort, just set hasRun and exit.
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
    let testBranch = getDCTreatment() ? kBranchTreatment : kBranchControl;

    if (testBranch === kBranchTreatment) {
      // TODO: What if we crash in interim period? Need a way to revert this for good...
      // setTimeout doesn't appear to be available
      prefManager.setBoolPref(kDelegatedCredentialsPref, true);
    } else {
      prefManager.setBoolPref(kDelegatedCredentialsPref, false);
    }

    Services.telemetry.registerEvents(kTelemetryCategory, kTelemetryEvents);
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
