// The fixed parts of the requirements workbook, taken from the ones the
// business writes today rather than invented.
//
// Everything here is boilerplate: the same words on every form. What varies is
// which channels appear, which is decided by the buttons placed, and the field
// table, which is decided by the fields.
//
// A step is [label, note]. The label goes in the Form Field column and the note,
// where there is one, in Logic, matching how the existing sheets read.

import { DATE_PATTERN } from './fieldFormat.js';

// Rows 2 to 11 of every sheet. Every one is filled from Config, named here by
// the entry it reads, so nothing in this block is guessed. A filled in guess
// would be taken for a checked fact.
export const METADATA_ROWS = [
  { label: 'Post Processing Req’d', from: 'postProcessing' },
  { label: 'Admin Q Req’d', from: 'adminQueue' },
  { label: 'Support Services Q Req’d', from: 'supportServices' },
  { label: 'FO Cabinet', from: 'foCabinet' },
  { label: 'FO Form ID', from: 'formId' },
  { label: 'FO Form Description', from: 'formDescription' },
  { label: 'Form Name', from: 'formName' },
  { label: 'Form Menu Group(s)', from: 'formMenuGroups' },
  { label: 'Product Codes', from: 'productCodes' },
  { label: 'Membership Type', from: 'formType', note: 'Person, Organization or Combined' },
];

// Keyed by the button that offers the channel, so a form gets the sections it
// actually has. A form with one button gets one expanded block and the rest as
// bare headings, which is what the trust form does.
export const CHANNEL_STEPS = {
  PhoneAuthButton: {
    title: 'Phone Auth',
    steps: [
      ['Phone Auth Button on Form'],
      ['Signing Field is Editable'],
      ['__Save Validations', 'Validated all Save Validations'],
      ['Signature Save Validation'],
      ['__Fileoptics'],
      ['Form landed in Post Processing if applicable'],
      ['Form landed in Admin Q if applicable'],
      ['Form landed in Support Services Q if applicable'],
      ['Form Processed Successfully', 'landed in submitted to FO Q'],
      ['Signing Authorization Buttons Hidden'],
      ['All form fields complete', 'no details were lost or dropped'],
      ['Red required items disappear'],
      ['Unused signing dates removed'],
      ['View FO completed form under member browse'],
      ['Form saved to TRO'],
    ],
  },
  DigitalSignatureButton: {
    title: 'In-Branch eSign',
    steps: [
      ['In-Branch eSign Button on Form'],
      ['__Save Validations', 'Validated all Save Validations'],
      ['__Fileoptics'],
      ['Form found in Pending In-Branch eSign Queue', '*All signers'],
      ['Form landed in Post Processing if applicable'],
      ['Form landed in Admin Q if applicable'],
      ['Form landed in Support Services Q if applicable'],
      ['Form Processed Successfully', 'landed in submitted to FO Q'],
      ['Signing Authorization Buttons Hidden', 'confirm buttons are hidden'],
      ['Signing Locations (All)', 'confirm signatures are inline and no overlap'],
      ['Date Stamp Location (All)', 'confirm dates are inline and no overlap'],
      ['Form Date Cleared (All)', 'confirm dates are new FO dates and not original'],
      ['All form fields complete', 'no details were lost or dropped'],
      ['Red required items disappear'],
      ['Grey radio button box disappear'],
      ['Unused signing dates removed'],
      ['Complete full signing', 'All required and available name fields and witness signature'],
      ['View FO completed form under member browse'],
      ['__Signing Placeholders', 'Review all placeholders for signing'],
      ['Form saved to TRO'],
    ],
  },
  RemoteESignButton: {
    title: 'Remote eSign',
    steps: [
      ['Remote eSign Button on Form'],
      ['__Save Validations', 'Validated all Save Validations'],
      ['__Fileoptics'],
      ['Signing Email from One Span Rec’d', '*All signers'],
      ['Form landed in Post Processing if applicable'],
      ['Form landed in Admin Q if applicable'],
      ['Form landed in Support Services Q if applicable'],
      ['Form Processed Successfully', 'landed in submitted to FO Q'],
      ['Signing Authorization Buttons Hidden', 'confirm buttons are hidden'],
      ['Signing Locations (All)', 'confirm signatures are inline and no overlap'],
      ['Date Stamp Location (All)', 'confirm dates are inline and no overlap'],
      ['Form Date Cleared (All)', 'confirm dates are new FO dates and not original'],
      ['All form fields complete', 'no details were lost or dropped'],
      ['Red required items disappear'],
      ['Grey radio button box disappear'],
      ['Unused signing dates removed'],
      ['Complete full signing', 'All required and available name fields and witness signature'],
      ['View FO completed form under member browse'],
      ['__Signing Placeholders', 'Review all placeholders for signing'],
      ['Form saved to TRO'],
    ],
  },
  PrintButton: {
    title: 'Print Only',
    steps: [
      ['Print Only Button on Form', 'no other options available'],
      ['Print Button to execute save validations'],
      ['Button functions to Print the form'],
    ],
  },
  // From the Internal Transfer Authorization sheet, the one example that
  // filled this section in.
  SubmitForProcessingButton: {
    title: 'Submit for Processing',
    steps: [
      ['Submit for Processing Button on Form'],
      ['__Save Validations', 'Validated all Save Validations'],
      ['Signature Save Validation'],
      ['__Fileoptics'],
      ['Form landed in Post Processing if applicable'],
      ['Form landed in Admin Q if applicable'],
      ['Form landed in Support Services Q if applicable'],
      ['Form Processed Successfully', 'landed in submitted to FO Q'],
      ['Signing Authorization Buttons Hidden'],
      ['All form fields complete', 'no details were lost or dropped'],
      ['Red required items disappear'],
      ['Unused signing dates removed'],
      ['View FO completed form under member browse'],
      ['Form saved to TRO'],
    ],
  },
};

// Every channel heading appears, in this order, expanded or not. A form that
// does not offer one still shows the heading, so a reader can see it was
// considered rather than forgotten.
export const CHANNEL_ORDER = [
  'PhoneAuthButton',
  'DigitalSignatureButton',
  'RemoteESignButton',
  'PrintButton',
  'SubmitForProcessingButton',
];

// [label, value, note]. Two of these this tool does know, the font and the date
// format, and both are stated rather than left blank because they are properties
// of what it produces.
export const STANDARD_REQUIREMENTS = [
  ['Error Message', 'Developers', 'Error: Your FileOpticsLibro.js file is missing. Open a ServiceNow ticket and assign to Service Desk'],
  ['New Data Feed Table', 'Developers', 'Address primary/secondary - primary & secondary ID (joint mbr)'],
  ['File Size', 'Developers', 'pdf resize - reduce file size'],
  ['Add Validation Function', 'Developers'],
  ['Tab Order', 'Developers', 'Confirm "tab" order makes sense within document'],
  ['"Check" in optional', 'Developers', 'Standard "Check" to be used in optional areas'],
  ['Verify Request User Logic', 'Developers', 'Accomodates the SAF Account'],
  ['Update Data Line with Details', 'BAs', 'Confirm data Line Doc has updated Tag, Cabinet and Folder'],
  ['Document View', '', 'form loads at 100%'],
  ['Document Font', 'Arial Size 10'],
  ['Date Format', DATE_PATTERN, '*All dates on forms should reflect this format'],
  ['Form Generation', '', 'Membership or Account Level'],
  ['Product Load Validations', 'Link to Product Listing'],
  ['Organization Not Applicable Message', '(applicable for Person only forms)'],
];

export const SIGNING_ROLES = [
  'Tax Reported for Owner (TRO)',
  'Non Tax Owner (OWN)',
  'Non Tax Signer (SIGN)',
  'Auth Sign Role at Organization Level',
  'Authorized Signatory @ Account Level',
];

export const POST_PRODUCTION = [
  ['Form Menu Group(s)'],
  ['FO Form ID in Form Menu Group(s)'],
  ['Form Name in Form Menu Group(s)'],
  ['Confirm Production FO', 'Phone Auth', 'If a "test" acct is NOT used then request removal'],
  ['Confirm Production FO', 'In - Branch eSign'],
  ['Confirm Production FO', 'Remote eSign', 'TEST account MUST be used'],
  ['Confirm Print Functionality', 'Required Fields Triggered with Print Button'],
  ['Confirm Submit Functionality', 'Required Fields Triggered with Submit Button'],
];

export const FINAL_SIGN_OFF = [
  ['Load Validations', 'Validate All LOAD Validations'],
  ['Form Field Validations', 'Editable Vs Read Only'],
];

// Which test columns a form gets, from its membership type. A combined form is
// tested against both a member and an organization, so it needs two of each.
export function testColumns(formType) {
  if (formType === 'org') return ['Org#'];
  if (formType === 'combined') return ['MEM#', 'Org#'];
  return ['MEM#'];
}
