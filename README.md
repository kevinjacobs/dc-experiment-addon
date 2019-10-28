## DC Experiment Addon

This is a WebExtension designed to test TLS Delegated Credentials in Firefox.

## How to install WebExtension

1. Install web-ext `npm install -g web-ext`
2. Install the dependencies `npm install`
3. Build the addon `npm run build`

## How to run WebExtension
1. `web-ext run --verbose -f Nightly`

You should see a new entry in the list of extensions titled "TLS Delegated Credentials Experiment".

In the browser console, you can see the result of the test. In order to re-run, toggle the "dc-experiment.hasRun" pref to false. Note you'll need to clear all site data for the test domain in order to clear SSL cache for the test domain.

## Dependencies

- [web-ext](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Getting_started_with_web-ext)
- Firefox 61+

## Contributing

See the [guidelines][contributing-link] for contributing to this project – including on how best to report an issue with this project.

This project is governed by a [Code Of Conduct][coc-link].

To disclose potential a security vulnerability please see our [security][security-link] documentation.

## [License][license-link]

This module is licensed under the [Mozilla Public License, version 2.0][license-link].
