## DC Experiment Addon

This is a WebExtension designed to test TLS Delegated Credentials in Firefox.

## How to install WebExtension

1. Install web-ext `npm install -g web-ext`
2. Install the dependencies `npm install`
3. Build the addon `npm run build`

## How to run as a WebExtension
1. `web-ext run --verbose -f Nightly`

You should see a new entry in the list of extensions titled "TLS Delegated Credentials Experiment".

In about:telemetry, search for "delegated" to see the results (if any) under the "Keyed Scalars" section. Note there will only be a result listed if you were
selected as part of the cohort (randomly by 2% chance). You can force this selection by creating and setting pref *dc-experiment.inCohort* to true.

In either case, there will be a new pref, *dc-experiment.hasRun*, that the script checks for before executing itself.

## How to run in-tree

As the experiment is planned for in-tree distribution, the preferred way to test would be to build your own Nightly, with the patch from <https://phabricator.services.mozilla.com/D51329> applied. This also makes persistance of the *dc-experiment.inCohort* pref easier to manage.

With the patch applied, you can check that the study has run by again looking for *dc-experiment.hasRun*, and any telemetry logged in about:telemetry.

## How to test

The study has two branches: **Control** and **Treatment**. Both branches will make a connection to https://kc2kdm.com by default, or the value of *dc-experiment.host* (hostname only, do not include "https://"), if specified. For the duration of this request, the **Treatment** branch has *security.tls.enable_delegated_credentials* flipped to True, and **Control** does not. You can force **Treatment** by creating and setting *dc-experiment.branchTreatment=true* or **Control** by setting it to false. If this pref does not exist, there's a 50% chance to be enrolled in either branch.

Once the test is run, browse to "about:telemetry#search=delegated" and look for a Keyed Scalar beginning with *delegatedcredentials#*. This first token identifies all telemetry entries created by the addon. The second token can be *connectNoDC* (**Control** branch was executed) or *connectDC* (**Treatment** branch was executed). The last token denotes the result as determined in the *populateResult* function.

For positive test cases, we're then looking for two possible entries: *delegatedcredentials#connectNoDC#hsNotDelegated* or *delegatedcredentials#connectDC#success*. Any other combination indicates some error occured. See the table below for more information.

**Result Scalar**|**Description**|**Generated by branch**|**How to test**
-----|-----|-----|-----
success|The connection was successful AND used a DC.|Treatment|This should be generated ~50% of the time
hsNotDelegated|The connetion was successful but did not use a DC (this is a success condition for Control branch, but a failure condition for Treatement).|Control, Treatment|This should be generated ~50% of the time if inCohort is set (and from Control only).|
timedOut|The connection timed out.|Control, Treatment|Update kDelegatedCredentialsHost to httpstat.us/408 (or any host that will resolve but timeout) and re-run the study.|
certNotDelegated|The server provided a DC, but the end-entity cert did not contain the Delegation Usage extension.|Treatment|This can be tested with a special xpcshell test sever. It has already been validated, but we can provide more detailed instructions if needed.|
dnsFailure|Name resolution failed.|Control, Treatment|Set kDelegatedCredentialsHost to some non-existant host (e.g. a GUID) and re-run the study.|
insufficientSecurity|DC was used in the handshake, but the key did not provide sufficient security.|Treatment|This can be tested with a special xpcshell test sever. It has already been validated, but we can provide more detailed instructions if needed.|
incorrectTLSVersion|DC was used in the handshake, but the key did not provide sufficient security|Control, Treatment|Set kDelegatedCredentialsHost to tls-v1-2.badssl.com:1012 and re-run the study.|
networkFailure|Any other unclassified failure.|Control, Treatment|Various|

**NOTE** If you are doing repeated testing that will switch branches, you'll want to set *browser.cache.disk_cache_ssl=false* before starting. If you've already started without this pref set, disable it then clear all browsing data.

## Dependencies

- [web-ext](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Getting_started_with_web-ext)
- Firefox 69+

