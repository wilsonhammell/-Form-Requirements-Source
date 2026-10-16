// Acrobat document-level script: Helper_Functions.
//
// Not app code. This is emitted as text and inserted into the exported PDF as a
// document-level JavaScript, so it is Acrobat's JavaScript, ES3 era: var only,
// no arrow functions, no let or const. Nothing here is executed by the designer.
//
// The //<Document-Level> XML wrapper Acrobat uses on export is added at
// insertion time, so this file stays plain JavaScript and can be read and
// syntax checked on its own.
//
// Acrobat runs document-level scripts in name order, so Helper_Functions runs
// before Main. These are definitions only, so the config Main declares is in
// place by the time any of them is called.

// FileOptics takes the Org eSigner list as a fixed width slot list in FO tag
// element 12, which is what caps a form at six signer rows.
var ESIGN_SLOT_COUNT = 6;

// Hooks a form defines for itself.
//
// A form's bespoke code lives in its own document-level script, or in Main.
// Export replaces Helper_Functions and Main and nothing else, but carries these
// across when it finds them in either, so all the generated code has to do is
// call them if they exist. Nothing here knows what they do.
//
// Written as plain functions, the same shape as CustomSaveValidation. The one
// difference is that CustomSaveValidation is emitted into Main, empty when the
// form has none, so it can be called bare. These are emitted only when the form
// has them, so every call site guards with typeof: a bare reference to a name
// nothing declared is a ReferenceError, and typeof is the only operator that
// tolerates one.
//
//   CustomAfterValidation()   in Main, once every load check has passed
//   CustomAfterLoad()         last thing Main does
//   CustomBeforeSubmit()      in each submit handler, once validation passed
//
// They take no arguments. What Main worked out is in the run time globals,
// IS_PERSON, SIGNER_COUNT, JOINT_POPULATED and CURRENT_AUTH_TYPE, read the same
// way the config block already is.
//
// ORDER MATTERS. Acrobat runs document scripts in name order and Main() is
// called at the bottom of its own script, so a script defining these has to
// sort before "Main" or its functions do not exist yet and the hook silently
// does not fire. Form_Custom works, ZZ_Custom does not.

function getSafeField(fieldName) {
    var field = this.getField(fieldName);

    if (field === null) {
        app.alert("Error: The field '" + fieldName + "' was not found.", 1);
        return null;
    }

    return field;
}

function getSafeValue(fieldName) {
    var field = getSafeField(fieldName);

    if (!field) { return ""; }

    return field.valueAsString.replace(/^\s+|\s+$/g, "");
}

function getFieldErrorMessage(fieldName, friendlyName) {
    var field = getSafeField(fieldName);

    if (field === null) return "";

    var value = field.valueAsString.replace(/^\s+|\s+$/g, "");

    if (value.length === 0) {
        return "- " + friendlyName;
    }

    return "";
}

function getSelectedText(fieldName) {
    var field = getSafeField(fieldName);

    if (!field || field.currentValueIndices === -1) {
        return "";
    }

    var label = field.getItemAt(field.currentValueIndices, false);
    return label.replace(/^\s+|\s+$/g, "");
}

// Row shape. SIGNER_ROWS is generated from what the designer placed, so these
// are what replaced the old form wide SIGNER_ROW_HAS_* flags. A row carries any
// subset of name, signature and signDate, and rows are always numbered 1 to N
// with no gaps.
function rowHas(index, part) {
    var row = SIGNER_ROWS[index - 1];
    return !!(row && row[part]);
}

function anyRowHas(part) {
    for (var i = 1; i <= MAX_SIGNERS_ON_FORM; i++) {
        if (rowHas(i, part)) {
            return true;
        }
    }

    return false;
}

// An array is a check box group, every box highlighted and counted as one error.
function flagError(fieldName) {
    var names = typeof fieldName === "string" ? [fieldName] : fieldName;

    for (var i = 0; i < names.length; i++) {
        var field = getSafeField(names[i]);
        if (field) {
            field.required = true;
        }
    }

    var errorCountField = getSafeField("ERRORS_FOUND");
    if (errorCountField) {
        errorCountField.value = Number(errorCountField.value) + 1;
    }
}

// The one message strip, FORM_MESSAGE. It replaced SUBMIT_SUCCESS,
// SUBMIT_FAILED, VALIDATE_REQ and eSIGN_FAILED, which were four boxes to place
// on every form and could never be on screen at the same time anyway.
//
// The colour moved with them. The box is drawn red, so a success sets green
// here and everything else leaves it alone, which is how the old pair read.
// These are the rgb values the example forms use, and MESSAGE_COLORS in
// systemFields.js holds the same two.
var MESSAGE_COLOR_ERROR = ["RGB", 0.898, 0.133, 0.215];
var MESSAGE_COLOR_SUCCESS = ["RGB", 0.415, 0.851, 0.156];

function showFormMessage(text, isSuccess) {
    var box = getSafeField("FORM_MESSAGE");

    if (!box) {
        return;
    }

    var tone = isSuccess ? MESSAGE_COLOR_SUCCESS : MESSAGE_COLOR_ERROR;

    box.value = text;
    box.textColor = tone;
    box.strokeColor = tone;
    box.readonly = true;
    box.display = display.visible;
}

// Hidden and emptied together, so a stale message can never outlive the attempt
// that produced it.
function clearFormMessage() {
    var box = getSafeField("FORM_MESSAGE");

    if (box) {
        box.value = "";
        box.display = display.hidden;
    }
}

function resetValidationState() {
    var errorsFound = getSafeField("ERRORS_FOUND");

    if (errorsFound) {
        errorsFound.value = 0;
    }

    clearFormMessage();
}

function setFieldState(fieldName, isVisible, isReadonly) {
    var field = getSafeField(fieldName);
    if (field) {
        field.display = isVisible ? display.visible : display.hidden;
        field.readonly = isReadonly;
    }
}

function setFileOpticsButtonsState(isVisible, isReadonly) {
    if (typeof FILEOPTICS_BUTTON_FIELDS === "undefined") {
        app.alert("Error: FILEOPTICS_BUTTON_FIELDS is not defined.", 1);
        return;
    }

    for (var i = 0; i < FILEOPTICS_BUTTON_FIELDS.length; i++) {
        var button = getSafeField(FILEOPTICS_BUTTON_FIELDS[i]);

        if (button) {
            button.display = isVisible ? display.visible : display.hidden;
            button.readonly = isReadonly;
        }
    }
}

function disableAllSigners() {
    for (var i = 1; i <= MAX_SIGNERS_ON_FORM; i++) {
        if (rowHas(i, "name")) {
            setFieldState("Member" + i + "Name", false, true);

            var menu = getSafeField("Member" + i + "Name");
            if (menu) {
                menu.clearItems();
            }
        }

        if (rowHas(i, "signature")) {
            setFieldState("Member" + i + "Signature", false, true);
        }

        if (rowHas(i, "signDate")) {
            setFieldState("Member" + i + "SignDate", false, true);

            var sDate = getSafeField("Member" + i + "SignDate");
            if (sDate) {
                sDate.value = "";
            }
        }
    }
}

function enableSignerRows(count, autoFillDate, isPerson) {
    for (var i = 1; i <= count; i++) {
        if (i > MAX_SIGNERS_ON_FORM) break;

        if (rowHas(i, "name")) {
            setFieldState("Member" + i + "Name", true, false);
        }

        if (rowHas(i, "signDate") && autoFillDate) {
            var sDate = getSafeField("Member" + i + "SignDate");
            var primaryDate = getSafeValue("PRIMARY_SIGN_DATE");

            if (sDate) {
                sDate.value = primaryDate;
            }
        }
    }

    // Row 1 only, deliberately. A person signs for themselves, so the remaining
    // rows stay disabled until a name is picked.
    if (isPerson && MAX_SIGNERS_ON_FORM > 0 && count > 0) {
        if (rowHas(1, "signature")) {
            setFieldState("Member1Signature", true, false);
        }

        if (rowHas(1, "signDate")) {
            setFieldState("Member1SignDate", true, false);
        }
    }
}

function ProductValidation(codeTypes, productCodes) {
    var hasConfiguredCodeType = false;
    var hasConfiguredProductCode = false;
    var i;

    if (codeTypes) {
        for (i = 0; i < codeTypes.length; i++) {
            if (String(codeTypes[i]).replace(/^\s+|\s+$/g, "") !== "") {
                hasConfiguredCodeType = true;
                break;
            }
        }
    }

    if (productCodes) {
        for (i = 0; i < productCodes.length; i++) {
            if (String(productCodes[i]).replace(/^\s+|\s+$/g, "") !== "") {
                hasConfiguredProductCode = true;
                break;
            }
        }
    }

    if (!hasConfiguredCodeType || !hasConfiguredProductCode) {
        return true;
    }

    for (i = 0; i < codeTypes.length; i++) {
        var fieldName = String(codeTypes[i]).replace(/^\s+|\s+$/g, "");

        if (fieldName === "") {
            continue;
        }

        var val = getSafeValue(fieldName);

        if (productCodes.indexOf(val) !== -1) {
            return true;
        }
    }

    return false;
}

function LoadValidation(isPerson, requiredFields) {
    var fieldsToCheck = requiredFields.slice(0);

    if (!isPerson) {
        fieldsToCheck.push(["NAMES_MDAS", "Organizational/Account level roles are not setup correctly! Please create a ServiceNow ticket for the Business Solutions desk to correct the issue."]);
    }

    var msgs = [];

    for (var i = 0; i < fieldsToCheck.length; i++) {
        var error = getFieldErrorMessage(fieldsToCheck[i][0], fieldsToCheck[i][1]);
        if (error !== "") {
            msgs.push(error);
        }
    }

    var dnaReqField = getSafeField("DNA_REQ");
    var validIdField = getSafeField("VALID_ID");

    if (msgs.length > 0) {
        if (validIdField) {
            validIdField.value = "1";
        }

        if (dnaReqField) {
            dnaReqField.display = display.visible;
            dnaReqField.readonly = true;

            var header = "The following required information is missing:\n";
            dnaReqField.value = header + msgs.join("\n");
        }

        lockFormForDnaValidationFailure();
        return false;
    } else {
        if (validIdField) {
            validIdField.value = "0";
        }

        if (dnaReqField) {
            dnaReqField.display = display.hidden;
            dnaReqField.value = "";
        }

        return true;
    }
}

// PRIMARY_MEMBERSHIP_TYPE is P for a person membership and B for an
// organization. Anything that is not P reads as an organization, the way a blank
// IN_PERSNBR did before it replaced that field and IN_ORGNBR.
function isPersonMembership() {
    return getSafeValue("PRIMARY_MEMBERSHIP_TYPE").toUpperCase() === "P";
}

function MembershipTypeValidation(isPerson) {
    var dnaReq = getSafeField("DNA_REQ");
    var errorMsg = "";

    if (MEMBERSHIP_TYPE === "person" && !isPerson) {
        errorMsg = "This form is for Personal memberships only.";
    } else if (MEMBERSHIP_TYPE === "org" && isPerson) {
        errorMsg = "This form is for Organizational memberships only.";
    }

    if (errorMsg !== "") {
        if (dnaReq) {
            dnaReq.value = errorMsg;
            dnaReq.display = display.visible;
        }
        return false;
    }

    return true;
}

function lockFormForDnaValidationFailure() {
    setFileOpticsButtonsState(false, true);
}

function showDnaValidationError(message) {
    var validId = getSafeField("VALID_ID");
    var dnaReq = getSafeField("DNA_REQ");

    if (validId) {
        validId.value = "1";
    }

    if (dnaReq) {
        dnaReq.value = message;
        dnaReq.display = display.visible;
        dnaReq.readonly = true;
    }
}

function OrgSetup() {
    if (MAX_SIGNERS_ON_FORM === 0) return 0;

    if (!anyRowHas("name")) {
        return MAX_SIGNERS_ON_FORM;
    }

    var namesMdas = getSafeValue("NAMES_MDAS");
    var name_ctr = 0;

    for (var s = 1; s <= MAX_SIGNERS_ON_FORM; s++) {
        if (!rowHas(s, "name")) continue;

        var menu = getSafeField("Member" + s + "Name");
        if (menu) {
            menu.clearItems();
            menu.setItems([[" ", 0]]);
        }
    }

    if (namesMdas.length > 0) {
        var aNAMES_MDAS = namesMdas.split('|');

        for (var i = 0; i < aNAMES_MDAS.length; i++) {
            var aNAMES_MDAS2 = aNAMES_MDAS[i].split('<>');
            var displayName = aNAMES_MDAS2[1];

            for (var j = 1; j <= MAX_SIGNERS_ON_FORM; j++) {
                if (!rowHas(j, "name")) continue;

                var targetMenu = getSafeField("Member" + j + "Name");
                if (targetMenu) {
                    targetMenu.insertItemAt(displayName, aNAMES_MDAS[i], -1);
                }
            }

            name_ctr++;
        }
    }

    for (var k = 1; k <= MAX_SIGNERS_ON_FORM; k++) {
        if (!rowHas(k, "name")) continue;

        var m = getSafeField("Member" + k + "Name");
        if (m) {
            m.value = 0;
        }
    }

    return name_ctr;
}

function PersonSetup()
{
    if (MAX_SIGNERS_ON_FORM === 0) return 0;

    if (!anyRowHas("name")) {
        return MAX_SIGNERS_ON_FORM;
    }

    var primaryName = getSafeValue("PRIMARY_FULL_LEGAL_NAME");
    var name_ctr = 1;

    for (var j = 1; j <= MAX_SIGNERS_ON_FORM; j++) {
        if (!rowHas(j, "name")) continue;

        var menu = getSafeField("Member" + j + "Name");
        if (menu) {
            menu.clearItems();

            var defaultItem = (j === 1) ? [primaryName, 0] : [" ", 0];
            menu.setItems([defaultItem]);
        }
    }

    for (var i = 1; i < MAX_DNA_SIGNERS; i++) {
        var signerName = getSafeValue("SIGNER" + i + "_FULL_LEGAL_NAME");
        var signerRole = getSafeValue("SIGNER" + i + "_ACCTROLE");

        if (signerName !== "" && signerRole !== "ITF") {
            for (var x = 1; x <= MAX_SIGNERS_ON_FORM; x++) {
                if (!rowHas(x, "name")) continue;

                var targetMenu = getSafeField("Member" + x + "Name");
                if (targetMenu) {
                    targetMenu.insertItemAt(signerName, i, -1);
                }
            }

            name_ctr++;
        }
    }

    for (var k = 1; k <= MAX_SIGNERS_ON_FORM; k++) {
        if (!rowHas(k, "name")) continue;

        var m = getSafeField("Member" + k + "Name");
        if (m) {
            m.value = 0;
        }
    }

    return name_ctr;
}

// The numbered rows and the combined line are independent, so a form carries
// either, both or neither and each is filled on its own. Both are guarded by
// what the designer placed, MAX_JOINT_LINES and HAS_COMBINED_JOINT, so nothing
// here asks for a field the form does not have.
//
// The rows stop at MAX_JOINT_LINES while the combined line takes everyone, so a
// form with both shows the first few in detail and the whole list in summary.
function PopulateJointData() {
    var joint_ctr = 1;
    var jointNames = [];

    for (var i = 1; i < MAX_DNA_SIGNERS; i++) {
        var sName = getSafeValue("SIGNER" + i + "_FULL_LEGAL_NAME");
        var sRole = getSafeValue("SIGNER" + i + "_ACCTROLE");
        var sNum = "";

        if (JOINT_ROW_HAS_MEMBER_NUMBER) {
            sNum = getSafeValue("SIGNER" + i + "_MEMBER_NUMBER");
        }

        if (sName !== "" && sRole !== "ITF") {
            jointNames.push(sName);

            if (joint_ctr <= MAX_JOINT_LINES) {
                var nameField = getSafeField(
                    "JointMember" + joint_ctr + "Name"
                );

                if (nameField) {
                    nameField.value = sName;
                }

                if (JOINT_ROW_HAS_MEMBER_NUMBER) {
                    var numField = getSafeField(
                        "JointMember" + joint_ctr + "Number"
                    );

                    if (numField) {
                        numField.value = sNum;
                    }
                }

                joint_ctr++;
            }
        }
    }

    if (HAS_COMBINED_JOINT) {
        var combinedField = getSafeField("JointMembers");

        if (combinedField) {
            combinedField.value = jointNames.join(", ");
        }
    }
}

// A group none of whose boxes are on the form has nothing to flag, so it passes.
function anyBoxTicked(fieldNames) {
    var placed = false;

    for (var i = 0; i < fieldNames.length; i++) {
        var field = getSafeField(fieldNames[i]);
        if (!field) continue;
        placed = true;
        if (field.value !== "Off" && field.value !== "") {
            return true;
        }
    }

    return !placed;
}

function runBaseSaveValidationOnly()
{
    clearAllRequired();
    resetValidationState();

    for (var i = 0; i < SAVE_VALIDATION_FIELDS.length; i++) {
        var fieldName = SAVE_VALIDATION_FIELDS[i];

        if (typeof fieldName !== "string") {
            if (!anyBoxTicked(fieldName)) {
                flagError(fieldName);
            }
            continue;
        }

        var field = getSafeField(fieldName);

        if (!field) continue;

        var val = "";

        if (field.type === "combobox") {
            val = getSelectedText(fieldName);
        } else {
            val = getSafeValue(fieldName);
        }

        // An unticked check box or a radio group with nothing chosen reads Off.
        if (val === "" || ((field.type === "checkbox" || field.type === "radiobutton") && val === "Off")) {
            flagError(fieldName);
        }
    }

    CustomSaveValidation();
}

function showValidationResult()
{
    var errorsFound = getSafeField("ERRORS_FOUND");

    var errorCount = 0;

    if (errorsFound) {
        errorCount = Number(errorsFound.value);
    }

    if (errorCount > 0) {
        showFormMessage(errorCount + " errors have been found. Fields highlighted in RED are required before you can print/submit the form.", false);
        return false;
    } else {
        clearFormMessage();
        return true;
    }
}

function SaveValidation()
{
    runBaseSaveValidationOnly();
    return showValidationResult();
}

function clearAllRequired() {
    for (var i = 0; i < this.numFields; i++) {
        var fieldName = this.getNthFieldName(i);
        var field = getSafeField(fieldName);

        if (field && (field.type === "text" || field.type === "checkbox" || field.type === "radiobutton" || field.type === "combobox")) {
            field.required = false;
        }
    }
}

function setFO_TAG(varElement, varValue)
{
    var foField = getSafeField("FO_DATA_LINE");

    if (!foField) {
        return;
    }

    var strMODIFY_FO_TAG = foField.value;
    var aMODIFY_FO_TAG = strMODIFY_FO_TAG.split("#");

    aMODIFY_FO_TAG[varElement] = varValue;
    foField.value = aMODIFY_FO_TAG.join("#");
}

function validateManualSignatures(count, includeDates) {
    for (var i = 1; i <= count; i++) {
        if (!rowHas(i, "signature")) {
            continue;
        }

        var shouldValidateRow = false;

        if (rowHas(i, "name")) {
            var nameText = getSelectedText("Member" + i + "Name");
            shouldValidateRow = (i === 1 || nameText !== "");
        } else {
            shouldValidateRow = true;
        }

        if (shouldValidateRow) {
            var sig = getSafeValue("Member" + i + "Signature");
            if (sig === "") {
                flagError("Member" + i + "Signature");
            }

            if (includeDates && rowHas(i, "signDate")) {
                var sDate = getSafeValue("Member" + i + "SignDate");
                if (sDate === "") {
                    flagError("Member" + i + "SignDate");
                }
            }
        }
    }
}

function wipeManualSignatures() {
    for (var i = 1; i <= MAX_SIGNERS_ON_FORM; i++) {
        if (rowHas(i, "signature")) {
            var s = getSafeField("Member" + i + "Signature");

            if (s) {
                s.value = "";
            }
        }

        if (rowHas(i, "signDate")) {
            var d = getSafeField("Member" + i + "SignDate");

            if (d) {
                d.value = "";
            }
        }
    }
}

function commonSubmitTags() {
    //setFO_TAG(10, getSafeValue("KeyingPostProcessingDate"));
    setFO_TAG(11, 1);                                          //admin

    var sub = getSafeField("SUBMITTED_TO_FO");
    if (sub) {
        sub.value = 1;
    }
}

// Every submission path calls one of these, not just Remote eSign, so a form
// that does not offer that channel would otherwise ask for fields it never
// placed and alert. HAS_ESIGN_FIELDS is generated from what is there.
function hideESignFields() {
    if (!HAS_ESIGN_FIELDS) {
        return;
    }

    var label = getSafeField("eSignLBL");
    var code = getSafeField("eSign_Code");

    if (label) {
        label.display = display.hidden;
    }

    if (code) {
        code.display = display.hidden;
        code.required = false;
    }
}

function showESignFields() {
    if (!HAS_ESIGN_FIELDS) {
        return;
    }

    var label = getSafeField("eSignLBL");
    var code = getSafeField("eSign_Code");

    if (label) {
        label.display = display.visible;
    }

    if (code) {
        code.display = display.visible;
        code.readonly = false;
    }
}

function validateESignCode() {
    if (!HAS_ESIGN_FIELDS) {
        return;
    }

    var code = getSafeValue("eSign_Code");

    if (code.length === 0) {
        flagError("eSign_Code");
    }
}

// Signers whose DNA record carries no email. Collected rather than appended to
// the message as they are found, since the strip takes one line and the old
// eSIGN_FAILED box took one line per name.
var MISSING_EMAIL_SIGNERS = [];

// Built at the end so the names read as a list. The count leads, because a long
// enough list still runs past two lines and the number survives the clipping.
function eSignFailureMessage() {
    var base = "Error: Your form did not get submitted to FileOptics for eSign.";

    if (MISSING_EMAIL_SIGNERS.length === 0) {
        return base;
    }

    return base + " " + MISSING_EMAIL_SIGNERS.length + " member(s) missing an email address: " +
        MISSING_EMAIL_SIGNERS.join(", ");
}

function prepareESigners() {
    MISSING_EMAIL_SIGNERS = [];

    if (!anyRowHas("name")) {
        var errorsFound = getSafeField("ERRORS_FOUND");
        if (errorsFound) {
            errorsFound.value = 1;
        }

        app.alert("Error: Remote eSign requires signer name dropdown fields.", 1);
        return "";
    }

    if (isPersonMembership()) {
        return preparePersonESigners();
    } else {
        return prepareOrgESigners();
    }
}

function preparePersonESigners() {
    var eSigners = "";
    var foField = getSafeField("FO_DATA_LINE");

    if (!foField) {
        return "";
    }

    var strFO_TAG = foField.value;
    var aFO_TAG = strFO_TAG.split("#");
    var aMemberEmailAddresses = aFO_TAG[3].split("~");

    // One slot per row, joined at the end. Building the string by appending
    // commas needs row 1 to be a special case, which breaks as soon as row 1 is
    // the one without a name dropdown.
    var slots = [];

    for (var i = 1; i <= MAX_SIGNERS_ON_FORM; i++) {
        if (!rowHas(i, "name")) {
            slots.push("");
            continue;
        }

        var memberName = getSelectedText("Member" + i + "Name");
        var memberElement = getSafeValue("Member" + i + "Name");
        var signerEmail = "";

        if (i === 1 || memberName !== "") {
            if (isTestEnvironment()) {
                signerEmail = promptForTestEmail(memberName);

                if (signerEmail !== "") {
                    aMemberEmailAddresses[memberElement] = signerEmail;
                }
            } else {
                signerEmail = aMemberEmailAddresses[memberElement];

                if (typeof signerEmail === "undefined") {
                    signerEmail = "";
                }
            }

            if (signerEmail !== "") {
                slots.push(memberElement);
            } else {
                var errorsFound = getSafeField("ERRORS_FOUND");
                if (errorsFound) {
                    errorsFound.value = 1;
                }

                MISSING_EMAIL_SIGNERS.push(memberName);

                // ERRORS_FOUND stops the submit before this is read, so the
                // slot only keeps the rows lined up.
                slots.push("");
            }
        } else {
            slots.push("");
        }
    }

    if (isTestEnvironment()) {
        setFO_TAG(3, aMemberEmailAddresses.join("~"));
    }

    eSigners = slots.join(",");
    eSigners = eSigners.toString().replace(/\s*/g, "");
    return eSigners;
}

// Positions 1 to signerCtr carry their index, the rest of the slots stay empty.
// This is what the old hand written signerCtr 1, 2 and 3 cases spelled out, so
// it matches them exactly and covers 4 through 6 as well.
function buildOrgESignerList(signerCtr) {
    if (signerCtr < 1) {
        return "";
    }

    var filled = Math.min(signerCtr, ESIGN_SLOT_COUNT);
    var parts = [];

    for (var i = 1; i <= ESIGN_SLOT_COUNT; i++) {
        parts.push(i <= filled ? String(i) : "");
    }

    return parts.join(",");
}

function prepareOrgESigners() {
    setFO_TAG(14, "Y");

    var signerCtr = 0;
    var signerNames = "~";
    var signerNumbers = "~";
    var signerEmails = "~";

    for (var i = 1; i <= MAX_SIGNERS_ON_FORM; i++) {
        if (!rowHas(i, "name")) {
            continue;
        }

        if (getSelectedText("Member" + i + "Name") !== "") {
            signerCtr = signerCtr + 1;

            var member = getSafeValue("Member" + i + "Name");
            var memberArray = member.split("<>");

            var signerNumber = memberArray[0];
            var signerName = memberArray[1];
            var signerEmail = memberArray[2];

            if (isTestEnvironment()) {
                signerEmail = promptForTestEmail(signerName);
            }

            signerNames = signerNames + signerName + "~";
            signerNumbers = signerNumbers + signerNumber + "~";
            signerEmails = signerEmails + signerEmail + "~";

            if (signerEmail === "" || typeof signerEmail === "undefined") {
                MISSING_EMAIL_SIGNERS.push(signerName);

                var errorsFound = getSafeField("ERRORS_FOUND");
                if (errorsFound) {
                    errorsFound.value = 1;
                }
            }
        }
    }

    setFO_TAG(1, getSafeValue("PRIMARY_MEMBER_NUMBER") + signerNumbers);
    setFO_TAG(2, getSafeValue("PRIMARY_FULL_LEGAL_NAME") + signerNames);
    setFO_TAG(3, signerEmails);

    return buildOrgESignerList(signerCtr);
}

function getFlowId(authType) {
    if (!isTestEnvironment()) {
        if (authType === "PHONE") return "FO";
        if (authType === "ESIGN") return "ES";
        if (authType === "DIGITAL") return "DS";
        if (authType === "SUBMIT") return "FO";
    } else {
        if (authType === "PHONE") return "TFO";
        if (authType === "ESIGN") return "TES";
        if (authType === "DIGITAL") return "TDS";
        if (authType === "SUBMIT") return "TFO";
    }

    return "";
}

function sendToFileOptics(flowId, successMsg) {
    var flowField = getSafeField("FLOW_ID");
    if (flowField) {
        flowField.value = flowId;
    }

    var errorsFound = getSafeField("ERRORS_FOUND");
    if (errorsFound && errorsFound.value != "0") {
        return;
    }

    if (typeof(FileOpticsLibro) === "function") {
        for (var i = 0; i < this.numFields; i++) {
            var fieldName = this.getNthFieldName(i);
            var f = getSafeField(fieldName);

            if (f) {
                f.readonly = true;
            }
        }

        setFileOpticsButtonsState(false, true);
        FileOpticsLibro(this, this.path);

        // The default is what SUBMIT_SUCCESS shipped with on every example
        // form. It used to live in the field, which one shared box cannot do.
        showFormMessage(
            successMsg && successMsg !== ""
                ? successMsg
                : "Your form has been successfully submitted to FileOptics",
            true
        );
    } else {
        showFormMessage("Error: Your FileOpticsLibro.js file is missing. Open a ServiceNow ticket and assign to Service Desk", false);
    }
}

function submitPhoneAuth() {
    CURRENT_AUTH_TYPE = "PHONE";

    hideESignFields();

    // The one channel where nobody signs electronically, so the member signs by
    // hand and staff authorises the identity by phone. Every other path either
    // wipes the manual signature or never looks at it.
    runBaseSaveValidationOnly();
    validateManualSignatures(MAX_SIGNERS_ON_FORM, true);

    if (!showValidationResult()) {
        return;
    }

    if (typeof CustomBeforeSubmit === "function") {
        CustomBeforeSubmit();
    }

    commonSubmitTags();
    sendToFileOptics(getFlowId("PHONE"), "");
}

function submitRemoteESign() {
    CURRENT_AUTH_TYPE = "ESIGN";

    showESignFields();

    runBaseSaveValidationOnly();
    validateESignCode();

    if (!showValidationResult()) {
        return;
    }

    if (typeof CustomBeforeSubmit === "function") {
        CustomBeforeSubmit();
    }

    wipeManualSignatures();

    var eSigners = prepareESigners();

    var errorsFound = getSafeField("ERRORS_FOUND");
    if (errorsFound && Number(errorsFound.value) > 0) {
        showFormMessage(eSignFailureMessage(), false);
        return;
    }

    commonSubmitTags();

    setFO_TAG(12, eSigners);
    setFO_TAG(13, getSafeValue("eSign_Code"));

    hideESignFields();

    sendToFileOptics(getFlowId("ESIGN"), "Your form has been successfully submitted to FileOptics for eSign");
}


// The filler writes ENVIRONMENT as it fills the form, so the same PDF is a test
// form or a live one by virtue of which filler produced it. Anything that is not
// PROD reads as test, so a form that never went through the filler cannot reach
// the live flows.
function isTestEnvironment() {
    return getSafeValue("ENVIRONMENT").toUpperCase() !== "PROD";
}

function promptForTestEmail(signerName) {
    var email = app.response({
        cQuestion: "Enter test email address for:\n\n" + signerName,
        cTitle: "Test eSign Email",
        cDefault: ""
    });

    if (email === null) {
        return "";
    }

    return email.replace(/^\s+|\s+$/g, "");
}

function submitDigitalSignature() {
    CURRENT_AUTH_TYPE = "DIGITAL";

    hideESignFields();

    runBaseSaveValidationOnly();

    if (!showValidationResult()) {
        return;
    }

    if (typeof CustomBeforeSubmit === "function") {
        CustomBeforeSubmit();
    }

    wipeManualSignatures();
    commonSubmitTags();

    sendToFileOptics(getFlowId("DIGITAL"), "");
}

// K_DCR's channel: a form nobody signs, sent straight to the FO flow, which is
// the one Phone Auth uses (TFO in its test copy, FO in production). It checks
// whatever signature rows are placed the way Phone Auth does, which on a form
// with none is nothing.
function submitForProcessing() {
    CURRENT_AUTH_TYPE = "SUBMIT";

    hideESignFields();

    runBaseSaveValidationOnly();
    validateManualSignatures(MAX_SIGNERS_ON_FORM, true);

    if (!showValidationResult()) {
        return;
    }

    if (typeof CustomBeforeSubmit === "function") {
        CustomBeforeSubmit();
    }

    commonSubmitTags();
    sendToFileOptics(getFlowId("SUBMIT"), "");
}


function submitPrintOnly() {
    CURRENT_AUTH_TYPE = "PRINT";

    if (!SaveValidation()) {
        return;
    }

    if (typeof CustomBeforeSubmit === "function") {
        CustomBeforeSubmit();
    }

    commonSubmitTags();

    for (var i = 0; i < this.numFields; i++) {
        var fieldName = this.getNthFieldName(i);
        var field = getSafeField(fieldName);

        if (field) {
            field.readonly = true;
        }
    }

    setFileOpticsButtonsState(false, true);

    // The print button is not a FileOptics one, so the call above does not
    // reach it. It has to hide itself, and before the print rather than after,
    // or it appears on the paper copy. Every form that predates this code did
    // exactly this.
    setFieldState("PrintButton", false, true);

    this.print();
}
