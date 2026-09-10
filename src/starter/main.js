// Acrobat document-level script: Main.
//
// Not app code. Emitted as text and inserted into the exported PDF as a
// document-level JavaScript, so it is Acrobat's JavaScript, ES3 era: var only,
// no arrow functions, no let or const. Nothing here is executed by the designer.
//
// Acrobat runs document-level scripts in name order, so Helper_Functions runs
// first and everything called below is already defined.
//
// The config block is per form and is generated from what the designer placed.
// The values here are defaults, standing in until the generator writes them.

//<CONFIG>

var FILEOPTICS_ENVIRONMENT = "TEST"; // TEST or PROD

// The Remote eSign label and code box. Placed with RemoteESignButton and sitting
// beside it, so this says whether the form carries them at all.
var HAS_ESIGN_FIELDS = false;

// The submission buttons placed on the form. PrintButton is not one of these,
// it never goes to FileOptics.
var FILEOPTICS_BUTTON_FIELDS = [
    "PhoneAuthButton",
    "RemoteESignButton",
    "DigitalSignatureButton"
];

// One entry per signer row, in order, so SIGNER_ROWS[0] is Member1. Generated
// from the Member{i}Name, Member{i}Signature and Member{i}SignDate fields
// placed on the form, so a row carries whichever of the three are there and the
// config can never disagree with the PDF.
//
// Rows are numbered 1 to N with no gaps, and cap at ESIGN_SLOT_COUNT, which is
// how many signers the FileOptics Org eSigner list has room for.
var SIGNER_ROWS = [
    { name: true, signature: true, signDate: true }
];

var MAX_SIGNERS_ON_FORM = SIGNER_ROWS.length;

var MAX_JOINT_LINES = 1;
var MAX_DNA_SIGNERS = 6;

var POPULATE_JOINT_DATA = true;
// Independent, not alternatives. A form can carry numbered rows, the combined
// line, or both. MAX_JOINT_LINES being 0 means no numbered rows.
var HAS_COMBINED_JOINT = false;
var JOINT_ROW_HAS_MEMBER_NUMBER = false;

// person, org, or combined
var MEMBERSHIP_TYPE = "combined";

// Define the product codes and whether you want to check the minor or major code field or both
var CODE_TYPES = [];
var PRODUCT_CODES = [];

// Define the fields you want to check for load validation [Field Name, User Friendly Name(For error message)]
var LOAD_VALIDATION_FIELDS = [
    ["REQUESTUSER", "Staff Name"],
    ["PRIMARY_SIGN_DATE", "Date"],
    ["PRIMARY_FULL_LEGAL_NAME", "Primary Full Legal Name"],
    ["IN_ACCTNBR", "Account Number"]
];

// Define the simple fields you want to check for save validation, conditional checks go into CustomSaveValidation()
var SAVE_VALIDATION_FIELDS = [];

// Conditional save validation, written per form. Empty when the form has none.
function CustomSaveValidation() {
}

//</CONFIG>

//Not for config. Worked out at run time rather than generated, and readable by
//a form's own hooks so a hook never recomputes a decision Main already made.
//
//Adding to this list is how a new decision reaches every form: no hook takes
//arguments, so nothing has to change to see it.
var CURRENT_AUTH_TYPE = "";
var IS_PERSON = false;
var PERSON_NUMBER = "";
var SIGNER_COUNT = 0;
var JOINT_POPULATED = false;

function Main()
{
    var dnaReq = getSafeField("DNA_REQ");
    if (dnaReq) {
        dnaReq.display = display.hidden;
    }

    if (getSafeValue("SUBMITTED_TO_FO") == "1") {
        return;
    }

    PERSON_NUMBER = getSafeValue("IN_PERSNBR");
    IS_PERSON = (PERSON_NUMBER.length > 0);

    if (!MembershipTypeValidation(IS_PERSON)) {
        return;
    }

    if (!ProductValidation(CODE_TYPES, PRODUCT_CODES)) {
        showDnaValidationError("Incorrect account selected in DNA. Please select a valid product.");
        lockFormForDnaValidationFailure();
        return;
    }

    if (!LoadValidation(IS_PERSON, LOAD_VALIDATION_FIELDS)) {
        return;
    }

    // Everything above decides whether the form runs at all, so this is the
    // first point a form's own code can rely on. Two forms in the example set
    // put their setup exactly here.
    if (typeof CustomAfterValidation === "function") {
        CustomAfterValidation();
    }

    disableAllSigners();

    if (IS_PERSON) {
        SIGNER_COUNT = PersonSetup();

        if (POPULATE_JOINT_DATA) {
            PopulateJointData();
            JOINT_POPULATED = true;
        }
    } else {
        SIGNER_COUNT = OrgSetup();
    }

    enableSignerRows(SIGNER_COUNT, true, IS_PERSON);

    setFileOpticsButtonsState(true, false);

    // After the buttons are shown, not before: a form that hides a channel has
    // to run second or it would be undone.
    if (typeof CustomAfterLoad === "function") {
        CustomAfterLoad();
    }
}

Main();
