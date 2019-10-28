"use strict";
/* global browser, runStudy */

const experiment = {
  async start() {
    browser.experiments.study.runTest();
  }
};

experiment.start();
