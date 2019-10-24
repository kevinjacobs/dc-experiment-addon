"use strict";
/* global browser, runStudy */

function log() {
  // eslint-disable-next-line no-constant-condition
  if (false) {
    // eslint-disable-next-line no-console
    console.log(...arguments);
  }
}


const rollout = {
  async getSetting(name, defaultValue) {
    let data = await browser.storage.local.get(name);
    let value = data[name];
    if (value === undefined) {
      return defaultValue;
    }
    return data[name];
  },

  async setSetting(name, value) {
    await browser.storage.local.set({[name]: value});
  },

  async init() {
    log("calling init");

    // Register the events for sending pings
    browser.experiments.study.runTest();


  },

  async main() {
    // Listen to the captive portal when it unlocks
    browser.captivePortal.onStateChanged.addListener(rollout.onReady);
  }
};

const setup = {
  enabled: false,
  async start() {
    log("Start");
    let runAddon = true;//await browser.experiments.preferences.getUserPref("doh-rollout.enabled", false);
    if (!runAddon && !this.enabled) {
      log("First run");
    } else if (!runAddon) {
      log("Disabling");
      this.enabled = false;
      browser.storage.local.clear();
      //await stateManager.setState("disabled");
    } else {
      this.enabled = true;
      rollout.init();
    }

    //browser.experiments.preferences.onPrefChanged.addListener(() => this.start());
  }
};

setup.start();
