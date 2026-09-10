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

// FileOptics takes the Org eSigner list as a fixed width slot list in KCU tag
// element 12, which is what caps a form at six signer rows.
var ESIGN_SLOT_COUNT = 6;

// Hooks a form defines for itself.
//
// A form's bespoke code lives in its own document-level script. Export replaces
// Helper_Functions and Main and nothing else, so that script survives untouched
// and all the generated code has to do is call these if they exist. Nothing
// here knows what they do.
//
// Written as plain functions, the same shape as CustomSaveValidation. The one
// difference is that CustomSaveValidation is emitted into Main, empty when the
// form has none, so it can be called bare. These are never emitted, so every
// call site guards with typeof: a bare reference to a name nothing declared is
// a ReferenceError, and typeof is the only operator that tolerates one.
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

function flagError(fieldName) {
    var field = getSafeField(fieldName);
    if (field) {
        field.required = true;
    }

    var errorCountField = getSafeField("ERRORS_FOUND");
    if (errorCountField) {
        errorCountField.value = Number(errorCountField.value) + 1;
    }
}

function resetValidationState() {
    var errorsFound = getSafeField("ERRORS_FOUND");
    var validateReq = getSafeField("VALIDATE_REQ");

    if (errorsFound) {
        errorsFound.value = 0;
    }

    if (validateReq) {
        validateReq.display = display.hidden;
    }
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

            var header = "The following DNA data is missing and is required:\n";
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

function runBaseSaveValidationOnly()
{
    clearAllRequired();
    resetValidationState();

    for (var i = 0; i < SAVE_VALIDATION_FIELDS.length; i++) {
        var fieldName = SAVE_VALIDATION_FIELDS[i];
        var field = getSafeField(fieldName);

        if (!field) continue;

        var val = "";

        if (field.type === "combobox") {
            val = getSelectedText(fieldName);
        } else {
            val = getSafeValue(fieldName);
        }

        if (val === "") {
            flagError(fieldName);
        }
    }

    CustomSaveValidation();
}

function showValidationResult()
{
    var errorsFound = getSafeField("ERRORS_FOUND");
    var validateReq = getSafeField("VALIDATE_REQ");

    var errorCount = 0;

    if (errorsFound) {
        errorCount = Number(errorsFound.value);
    }

    if (errorCount > 0) {
        if (validateReq) {
            validateReq.readonly = true;
            validateReq.value = errorCount + " errors have been found. Fields highlighted in RED are required before you can print/submit the form.";
            validateReq.display = display.visible;
        }

        return false;
    } else {
        if (validateReq) {
            validateReq.display = display.hidden;
        }

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

        if (field && (field.type === "text" || field.type === "checkbox" || field.type === "combobox")) {
            field.required = false;
        }
    }
}

function setKCU_TAG(varElement, varValue)
{
    var kcuField = getSafeField("KCU_FO_DATA_LINE");

    if (!kcuField) {
        return;
    }

    var strMODIFY_KCU_TAG = kcuField.value;
    var aMODIFY_KCU_TAG = strMODIFY_KCU_TAG.split("#");

    aMODIFY_KCU_TAG[varElement] = varValue;
    kcuField.value = aMODIFY_KCU_TAG.join("#");
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
    //setKCU_TAG(10, getSafeValue("KeyingPostProcessingDate"));
    setKCU_TAG(11, 1);                                          //admin

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

function prepareESigners() {
    if (!anyRowHas("name")) {
        var errorsFound = getSafeField("ERRORS_FOUND");
        if (errorsFound) {
            errorsFound.value = 1;
        }

        app.alert("Error: Remote eSign requires signer name dropdown fields.", 1);
        return "";
    }

    if (getSafeValue("IN_PERSNBR").length > 0) {
        return preparePersonESigners();
    } else {
        return prepareOrgESigners();
    }
}

function preparePersonESigners() {
    var eSigners = "";
    var kcuField = getSafeField("KCU_FO_DATA_LINE");

    if (!kcuField) {
        return "";
    }

    var strKCU_TAG = kcuField.value;
    var aKCU_TAG = strKCU_TAG.split("#");
    var aMemberEmailAddresses = aKCU_TAG[3].split("~");

    var failedField = getSafeField("eSIGN_FAILED");
    if (failedField) {
        failedField.value = "Error: Your form did not get submitted to FileOptics for eSign.\nThe following members are missing their email:";
    }

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

                if (failedField) {
                    failedField.value = failedField.value + "\n- " + memberName;
                }

                // ERRORS_FOUND stops the submit before this is read, so the
                // slot only keeps the rows lined up.
                slots.push("");
            }
        } else {
            slots.push("");
        }
    }

    if (isTestEnvironment()) {
        setKCU_TAG(3, aMemberEmailAddresses.join("~"));
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
    setKCU_TAG(14, "Y");

    var failedField = getSafeField("eSIGN_FAILED");

    if (failedField) {
        failedField.value = "Error: The following persons are missing their email in DNA which is required for Remote eSign";
    }

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
                if (failedField) {
                    failedField.value = failedField.value + "\n- " + signerName;
                }

                var errorsFound = getSafeField("ERRORS_FOUND");
                if (errorsFound) {
                    errorsFound.value = 1;
                }
            }
        }
    }

    setKCU_TAG(1, getSafeValue("PRIMARY_MEMBER_NUMBER") + signerNumbers);
    setKCU_TAG(2, getSafeValue("PRIMARY_FULL_LEGAL_NAME") + signerNames);
    setKCU_TAG(3, signerEmails);

    return buildOrgESignerList(signerCtr);
}

function getFlowId(authType) {
    if (FILEOPTICS_ENVIRONMENT === "PROD") {
        if (authType === "PHONE") return "FO";
        if (authType === "ESIGN") return "ES";
        if (authType === "DIGITAL") return "DS";
    } else {
        if (authType === "PHONE") return "TFO";
        if (authType === "ESIGN") return "TES";
        if (authType === "DIGITAL") return "TDS";
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

    if (typeof(FileOptics) === "function") {
        for (var i = 0; i < this.numFields; i++) {
            var fieldName = this.getNthFieldName(i);
            var f = getSafeField(fieldName);

            if (f) {
                f.readonly = true;
            }
        }

        setFileOpticsButtonsState(false, true);
        FileOptics(this, this.path);

        var sField = getSafeField("SUBMIT_SUCCESS");
        if (sField) {
            if (successMsg && successMsg !== "") {
                sField.value = successMsg;
            }

            sField.display = display.visible;
        }
    } else {
        var failedField = getSafeField("SUBMIT_FAILED");
        if (failedField) {
            failedField.display = display.visible;
        }
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
        var failedField = getSafeField("eSIGN_FAILED");
        if (failedField) {
            failedField.display = display.visible;
        }

        return;
    }

    commonSubmitTags();

    setKCU_TAG(12, eSigners);
    setKCU_TAG(13, getSafeValue("eSign_Code"));

    hideESignFields();

    sendToFileOptics(getFlowId("ESIGN"), "Your form has been successfully submitted to FileOptics for eSign");
}


function isTestEnvironment() {
    return FILEOPTICS_ENVIRONMENT === "TEST";
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
