# PDF Requirement Designer

Browser-based tool for placing AcroForm fields on a PDF visually, naming them
from a known DB field list, and exporting a working fillable PDF plus a
machine-readable requirements file. Replaces placing and naming fields by hand
in Acrobat against an Excel spec.

Single-page app, no backend. Nothing is uploaded anywhere, all work happens in
the browser.

## Running it

```
npm install
npm run dev       # http://localhost:5173
npm run build     # static files in dist/, serve them from anywhere
```

## What matters most: field names

A separate application fills these PDFs by matching PDF field names to DB column
names. The exported name has to be exactly right or the fill silently does
nothing, so the tool is built around that:

- **Load Attempted** is *derived*, never stored. A field is Load Attempted when
  its name exactly matches an `identifier` in the DB field list.
- **Load Validation** is stored (`loadValidated` in the JSON), but may only be
  true while the field is Load Attempted. Change the name so it no longer
  matches and the flag clears itself, and its checkbox disables.
- Matching is case sensitive. If a name differs only by case the name box says
  so and offers the correct one, rather than quietly passing.
- Only the `identifier` is ever persisted. Labels are display only.

**Error Message Field Name** (`customerFacingName`) is what the field is labelled
on the form a customer reads, and is the name the load validation error message
uses when it is missing. One DB field wears different labels on different
forms, `CUSTNAME` might be "Name" on one and "Account Holder" on another, so it
belongs to the placement rather than to the DB list. Load Validation requires
it: validating that a field loads is a claim about a specific label on a
specific form, so the checkbox stays disabled until it is filled, and clearing
it later clears the flag.

**Save Validation** (`saveValidated`) sits beside it but is independent. Any
field can carry it, named or not, in the DB list or not.

**Custom Save Validation** (`customSaveValidated`) is the exception case, for a
field whose save behaviour the plain flag cannot describe. Two rules hold it in
place:

- It is **mutually exclusive** with Save Validation. Checking either one clears
  the other.
- It **requires a note**, because the note is what describes the custom
  situation. The checkbox stays disabled until the note has content, and if the
  note is later emptied the flag clears itself.

If a hand edited file somehow arrives with both save flags set, plain Save
Validation wins, being the one with no preconditions of its own.

## Visibility

A field can be flagged **hidden**, meaning the widget is neither drawn on screen
nor printed. It is written as the Hidden annotation flag, PDF 32000-1 table 165
bit 2.

Unlike read-only, which is a field level flag shared by every placement of a
name, visibility lives on the widget. So one placement of a name can be hidden
while another shows, and each option of a radio group can be hidden
independently. The model follows that: `hidden` belongs to the placement.

Hiding does not clear the Print flag. The two answer different questions, and a
hidden widget is not rendered either way.

Hidden fields read as faint on the page with a `· hidden` label, and carry a
**HID** badge in the field list.

## System fields

The fields the starter code reads. They belong on every form, whether that form
needs them or not, because standardising them is the point. Defined in
[`public/systemFields.json`](public/systemFields.json), 35 of them, all text.

Membership is **derived from the name**, exactly as Load Attempted is. Nothing
is stored on the field, so swapping the file reclassifies everything at once. A
name can be both a system field and a DB field, the two derivations are
independent and both may be true.

The invariant: **every system name keeps at least one placement.** Its last
placement cannot be deleted or renamed, and the Delete key will not remove it
either. Everything else about it is yours: position, size, page, visibility and
read-only are all editable, and they default to hidden and read-only.

Extra placements are ordinary fields. That is how a value shows in more than one
place, a member number wanted on the form as well as in the code: one PDF field,
one value, several widgets. Only the last one is protected.

Missing ones are added when a document is opened, by any of the three routes,
laid out against the real page rather than at stored coordinates:

- **Compact** fields run left to right along the top, wrapping onto another row
  when the width runs out.
- **Signer** fields sit along the bottom, a column per signer, five across,
  since that is roughly where they land on a real form.
- **Wide** fields, `FORM_MESSAGE` and `DNA_REQ`, take 80% of the page width,
  because those are shown to a person and `DNA_REQ` often gets stretched further
  still.

The **All / Standard / System / Signers / Submission** filter above the field list applies to the page
as well, and **starts on Standard**, so a form opens showing what it is actually
about rather than 35 pieces of infrastructure.

Where a system name is placed more than once, only the **system placement
filters as System** and the rest filter as Standard, because those extra ones
exist to show the value on the form and behave like any other field. That is
also what keeps a standard field from vanishing when it is renamed to a system
name that is already on the form.

The system placement is the box this tool placed, and it carries a
`systemPlacement` flag in the JSON. Copies never get the flag, whether drawn,
duplicated or pasted, so which box is the system one never depends on field
order. It cannot be renamed or removed; copies can. A box carrying a system
name without the flag is an ordinary field, and on import the system one is
placed alongside it.

Colour follows the same split, and says one thing rather than four: a system
field is grey and recedes, an ordinary field is blue, and green means Load
Attempted. The extra placements are blue for the same reason they filter as
Standard.

Imported fields carry no colour of their own. The property panel still says a
field was rebuilt from an existing AcroForm and that its name and position are
inferred, which is the part worth knowing.

The list is also authoritative about type. A document carrying a system name as
something other than text is **corrected on the way in**, keeping its position
and size, and the import notes say which ones changed. Only reporting it would
be a dead end: the system placement of a system name cannot be deleted or renamed,
and type is fixed once a field is drawn, so nothing would be left to fix it
with.

## Submission buttons

The signing channels a form offers: Phone Auth, In-Branch eSign, Remote eSign
and Print Form.

Defined in [`src/core/signingButtons.js`](src/core/signingButtons.js), in source
rather than in a data file. `dbFields.json` and `systemFields.json` are swapped
by the business; nothing about a button is. The captions are the product's, the
sizes are fixed, and the action is JavaScript this repo maintains, the same for
every form and changed in one place. None of it is configurable from the
front end, and nobody using this tool edits code.

These are pushbuttons, and a pushbutton **has no value**. Nothing fills one,
nothing validates one, and the filler skips them, so they carry none of the
machinery the other four types do: no export value, no options, no alignment,
no Load or Save Validation, no customer-facing name.

The field type is plain `button`, and membership in the list is what makes one a
*submission* button, derived from the name the way system fields are. A generic
button, should one ever be wanted, is the same type with a name that is not in
the list, so nothing has to be renamed to make room for it.

**Placing a button is what says the form supports that channel**, so there is no
separate flag to fall out of step with the buttons themselves. They are turned
on and off from the Config tab, and the rule is the mirror of a system field's:
**at most one** placement of each name, where a system name needs at least one.

A form can offer none of them or all four. They start hidden, shown by the
starter code at run time, and their size is fixed by the list, so they move but
do not resize. Each keeps its own slot, so adding a third does not shuffle the
two already placed. Turning one on switches the field scope to Submission, since
that is the only scope the button appears in.

### Look

Every button is the same, so the styling is one constant, `BUTTON_STYLE`:

| | value | written as |
| --- | --- | --- |
| size | 80 x 18 pt | the widget rect |
| border colour | black | `/MK /BC [0 0 0]` |
| fill colour | green | `/MK /BG [0 1 0]` |
| border width | 1, thin | `/BS /W 1` |
| border style | beveled | `/BS /S /B` |
| caption font | Helvetica 10 | `/DA`, with the font registered in `/DR` |

The size comes from measuring a real button at 1.1007 x 0.2514 inches. At 72
points to the inch that is 79.25 x 18.10, rounded to **80 x 18**: a quarter inch
tall exactly, and under a point wider, which is not a visible difference.

A button is the one type that is genuinely drawn in the exported PDF, so the
designer draws it rather than outlining it, and shows it at full strength even
while it is hidden. Acrobat does the same, and since every button starts hidden,
dimming them would make the normal case the hard one to see. Selection shows as
an outline, because the fill and border are the button's own.

A pushbutton whose name is not in the list is **not touched**: not imported, not
moved, not removed. That is the conservative reading until generic buttons are
actually asked for.

Each entry carries the `script` run when the button is pressed, a single call
into the helper script, and a `fileOptics` flag saying whether it belongs in
`FILEOPTICS_BUTTON_FIELDS`. **Print is the one that does not**, since it never
goes to FileOptics, which is why both example forms list only three.

The script goes in `/A`, the annotation's **activation** action, which for a
widget is the mouse released inside it. That is Acrobat's Mouse Up trigger.
`/AA /U` is the other way to say the same thing, and setting both would run the
script twice, so only `/A` is written.

## Special fields

Signer rows, joint rows and the combined joint line: a third family beside
system fields and submission buttons. Defined in
[`src/core/specialFields.js`](src/core/specialFields.js).

What sets them apart is that their names are **generated from a pattern and an
index** rather than picked from a list, their count is driven by the form, and
they are visible and member facing rather than infrastructure.

| | system | special | standard |
| --- | --- | --- | --- |
| present | always, all 38 | conditionally | as designed |
| name | fixed list | pattern plus index | DB list |
| type | all text | fixed per role | chosen |
| visible | hidden by default | visible, editable | visible |
| colour | grey | **teal** | blue |

### The families

| name | type | notes |
| --- | --- | --- |
| `Member{i}Name` | dropdown | options built at run time from DNA, none at design time |
| `Member{i}Signature` | text | a text field, not a PDF signature field |
| `Member{i}SignDate` | text | auto filled from `PRIMARY_SIGN_DATE` |
| `JointMember{i}Name` | text | |
| `JointMember{i}Number` | text | optional, offered once its row has a name |
| `JointMembers` | text | the combined alternative, names joined by commas |
| `eSignLBL` | text | the Remote eSign label, 93 x 14 |
| `eSign_Code` | text | the Remote eSign code box, 86 x 14 |

A signer row carries **any subset** of its three parts.

The two joint shapes are **independent, not alternatives**. `PopulateJointData`
used to branch on one flag and fill one or the other; it now fills each on its
own, so a form carries numbered rows, the combined line, both, or neither. The
rows stop at `MAX_JOINT_LINES` while the combined line takes every name, so a
form with both shows the first few in detail beside a full summary.

That was only ever an `if/else`, not a structural limit. The one thing the flag
was really guarding is that `getSafeField` alerts on a missing field, which is
solved properly by `HAS_COMBINED_JOINT` being derived from what was placed.

Signer rows cap at **6**, the eSign slot count. Joint rows cap at **5**, because
`PopulateJointData` loops `i < MAX_DNA_SIGNERS` and DNA supplies signers 1 to 5.

### The Remote eSign cluster

`eSignLBL` and `eSign_Code` are **placed with `RemoteESignButton` and move with
it**. Measured off a real form, they sit flush against the button's right edge,
running on from it and vertically centred:

| field | x | w | h |
| --- | --- | --- | --- |
| RemoteESignButton | 322.87 | 79.25 | 18.1 |
| eSignLBL | 402.95 | 92.98 | 13.56 |
| eSign_Code | 495.95 | 86.22 | 13.56 |

The button ends at 402.12 and the label starts at 402.95; the label ends at
495.93 and the code starts at 495.95. Flush, both ways. Rounded here the way the
button was, to 93 x 14 and 86 x 14. That also confirms the button width: 79.25
is exactly the 1.1007 inches measured, so **80** was right.

Turning the channel on places the pair, turning it off removes it, and dragging
the button drags them. The drag applies a **delta rather than relaying out**, so
a nudge to either one survives the button being moved afterwards. They live in
the **Submission** scope with their button rather than with the signer rows.

Both ship **hidden**, the same as the button they belong to, and
`showESignFields` reveals them. Left visible they would sit on the page whether
or not the form offers Remote eSign. Only `eSign_Code` is editable; `eSignLBL`
is a caption, so it is read-only. This matches the real form, where both carry
annotation flags 6, hidden plus print.

`hideESignFields` runs on *every* submission path, not only Remote eSign, so a
form without the pair used to alert through `getSafeField`. `HAS_ESIGN_FIELDS`,
derived from what is placed, now guards `hideESignFields`, `showESignFields` and
`validateESignCode`. Half a pair is reported as an issue, which only an import
can produce.

### Illegal states are unreachable

The name picker offers a special name **only while placing it would be valid**:
the parts a row is still missing, and the next row's parts. So `Member3Name` is
not in the list until row 2 exists, and `JointMembers` is offered until it is
placed and never twice.

Nothing validates contiguity, because nothing can produce a gap. Deleting the
last part of a row **renumbers the rows after it** and says what moved; positions
stay where they are, only names shift up.

`specialFieldIssues` exists for the one case placement cannot prevent: a PDF
imported with a gap already in it.

### Placing

Two routes, and Config never leaves you guessing which names exist.

**Draw a box and pick the name.** That is how you trace artwork, and it is the
only route that lets you put a field exactly where the printed form wants it.

**Or place it from Config**, which drops the field where the row lays it out and
switches the scope to Signers so it is visible. The joint block lays out from the
top of the page, under the signing buttons, and the signer rows up from the
bottom, so neither block can grow into the other:

- **Add signer row** drops all three parts of the next row.
- **A part a row is missing shows as a dashed `+ Signature` button.** Delete one
  part of a row and the row survives without it, so this is how you put it back
  rather than having to draw a box and know the name.
- **Add joint row** and **Add combined line** place either joint shape, or both.
  Only the combined line disappears once placed, since there is just one of it.
- **`+ Member number`** adds the optional half of a joint row.

Every one of those goes through `addSpecialField`, which refuses any name the
picker would not have offered. One rule, in one place, so a shortcut cannot make
a state drawing could not.

Type follows the name: naming a box `Member1Name` makes it a dropdown. Imported
files are corrected by `reconcileSpecialTypes`, the same way system field types
are, so a wrong type is never an unfixable dead end.

### Everything derives

The config block and the field scripts are built from one derivation, so they
cannot disagree:

| config | derived from |
| --- | --- |
| `SIGNER_ROWS` | which `Member{i}*` fields exist, per row |
| `MAX_SIGNERS_ON_FORM` | `SIGNER_ROWS.length` |
| `POPULATE_JOINT_DATA` | any joint field placed |
| `HAS_COMBINED_JOINT` | `JointMembers` placed, independent of the rows |
| `MAX_JOINT_LINES` | highest `JointMember{i}` index |
| `JOINT_ROW_HAS_MEMBER_NUMBER` | any `JointMember{i}Number` placed |

Config shows all of it read only. There is nothing to set.

## Initials markers

Where FileOptics should be configured to put an initials box, and whose initials
belong there.

FileOptics places initials in its own step, one that never touches the PDF and
is not done in Acrobat, so until now there was nowhere to write down what the
business wanted. A marker is that note. It carries coordinates, because where
the box goes is most of the answer, and a person, because it is as often a
guarantor, an overseer or a branch manager as a member.

**A marker is not a field.** It lives in its own `markers` array beside `fields`
rather than as a flag on one, which is what keeps every rule a field carries true
of fields by construction: a name that has to match the DB list, an export value,
a type, a generated OnBlur script. None of them need to learn a new case, and
[`pdfExport.js`](src/core/pdfExport.js) never has to know markers exist.

Nothing about a marker reaches the AcroForm, the starter code or the downstream
filler. Tests export the same form twice, with markers and without, and assert
the page annotations, the AcroForm field list and the document scripts are
identical. What grows is the requirements JSON, which is embedded in the PDF, so
the file is larger and the form inside it is not.

Making them hidden fields would have been cheaper and is what the tool nearly
did. A hidden field is still a real field: it is written to the AcroForm, the
filler sees it when it walks the page annotations, it takes a slot in tab order,
and it would need a name in a tool whose one job is that names are exactly
right. It would also not survive a round trip, since an imported AcroForm is
rebuilt from widgets and nothing about a marker could be inferred from one.

### Placing one

**Initials** sits in the toolbar's Draw row, set apart by a rule because it is
the one button there that does not draw a field. Drag on the page and a marker
appears, amber and dashed all round so it cannot be read as a field. A field
uses a dashed border to mean read-only, which a marker has no notion of.

They filter with **Signers**, since that scope already answers the question a
marker answers, who marks this form and where. Drawing one switches to that
scope, the same way placing a signer row does, so a marker does not vanish the
moment it is placed.

### The role is required, and reported rather than enforced

Custom Save Validation requires a note the same way, but it cannot be copied
straight across. That rule works because there is a *flag* to clear. A marker has
no flag, it cannot be refused before it is placed, since the box is drawn first
and labelled second, and clearing the text cannot delete it out from under
whoever is typing.

So `markerIssues` reports an unlabelled marker as an **error** in the issues
panel, carrying its ids the way `fieldIssues` does, so clicking it filters the
page to exactly the boxes still missing an answer. The list shows one as `who
initials here?` with a red `!`. Export is not blocked, which matches every other
must-fix in the tool.

### Free text, on purpose

Nothing constrains the role. The five entries in `SIGNING_ROLES` are FileOptics
signing roles and cover none of the people this is actually for. The value is a
plain string, so a suggestion list added later would read what is already stored
rather than migrate it.

### Where it comes out

A marker earns a row in the requirements workbook, in reading order among the
fields on its page, so it lines up against the same picture. It fills the
existing columns rather than adding any:

| column | marker row |
| --- | --- |
| Field | `Initials` |
| Form Field | the role, coloured amber |
| Load Validation | blank, nothing loads into an initials box |
| Save Validation | blank, nothing saves out of one |
| Logic | the note |
| Field Name | blank, there is no identifier to match on |

Form Field is left empty for a real field because it is the label a member reads
beside the box and only someone looking at the form can say it. For a marker the
role **is** that label, so the column fits rather than being borrowed. A marker
nobody named reads `(not specified)`, since a blank cell beside `Initials` would
look like an oversight.

Two initials boxes are two rows. That is not the repeated-name case, where one
field carries one value and there is one thing to test. Two boxes are two places
someone initials.

**And it is drawn on the page picture**, amber and dashed with the role as its
caption. That is the part that does the real work: a row gives a reader
coordinates, the picture is what shows them the place. The rest of the picture is
still rendered with `AnnotationMode.DISABLE`, so the marker is the only thing laid
over the printed form.

## Form config

The right panel switches between **Config** and **Fields**. Config is form level,
one set per document, carried in the requirements JSON.

- **Form Menu Group(s)**, **Form Name**, **FO Form ID**, **FO Form Description**
  and **FO Cabinet**, free text, all carried into the requirements workbook.
  Export also writes FO Form ID into `FORM_ID` and Form Name into `FORM_NAME`. A
  blank box clears the field. Opening a PDF fills a blank box from the field, so
  a form that already carries them keeps them.
- **Post Processing**, **Admin Queue** and **Support Services**, checkboxes.
  They fill the first three rows of the workbook's FO Processing block, a ticked
  box reading Yes and a clear one No.
- **Form type**, one of Person, Org or Combined.
- **Product codes(doc_sys)**, pasted in and stored as a list. Split on commas, and also on
  the newlines and tabs a spreadsheet column arrives with. Whitespace is trimmed,
  blanks and repeats dropped, order kept. Case is left exactly as typed, since
  something downstream matches on these and this tool does not get to decide.

```json
"config": {
  "formMenuGroups": "Deposits",
  "formId": "K_COV",
  "formDescription": "Overdraft protection agreement",
  "formName": "Coverdraft Protection",
  "foCabinet": "Member Services",
  "postProcessing": true,
  "adminQueue": false,
  "supportServices": false,
  "formType": "org",
  "productCodes": ["M101", "RSP"]
}
```

## Starter code

The Acrobat document-level JavaScript that ships inside a form, kept in
[`src/starter/`](src/starter/) so edits to it are ordinary edits.

| file | what it is |
| --- | --- |
| [`helpers.js`](src/starter/helpers.js) | `Helper_Functions`, the same on every form |
| [`main.js`](src/starter/main.js) | `Main`, config block plus the entry point |
| [`index.js`](src/starter/index.js) | imports both raw, exports them as text |

Every export writes both into the PDF, as document-level JavaScript, so an
exported form runs on open.

| file | what it is |
| --- | --- |
| [`buildScripts.js`](src/starter/buildScripts.js) | generates the config block, and Main around it |
| [`pdfScripts.js`](src/core/pdfScripts.js) | writes them into the PDF's name tree |

### Generating the config

`Helper_Functions` goes out verbatim. `Main` is the same file with its
`//<CONFIG>` region replaced by values worked out from what was placed, so the
config and the PDF cannot disagree:

| emitted | from |
| --- | --- |
| `SIGNER_ROWS`, `MAX_SIGNERS_ON_FORM` | the `Member{i}*` fields placed |
| `MAX_JOINT_LINES`, `HAS_COMBINED_JOINT`, `JOINT_ROW_HAS_MEMBER_NUMBER`, `POPULATE_JOINT_DATA` | the joint fields placed |
| `HAS_ESIGN_FIELDS` | whether the eSign pair is placed |
| `FILEOPTICS_BUTTON_FIELDS` | the placed buttons, **minus Print** |
| `LOAD_VALIDATION_FIELDS` | Load Validated, paired with the customer-facing name |
| `SAVE_VALIDATION_FIELDS` | Save Validated, excluding the custom ones |
| `MEMBERSHIP_TYPE`, `PRODUCT_CODES` | the Config tab |
| `CODE_TYPES` | constant `["PROD_CODE"]` |

### The one thing an export keeps

**An export replaces every line of script in the form except one.** The body of
`CustomSaveValidation` is bespoke, written by hand per form, so it is read out of
the document being exported and re-emitted inside the generated one. Everything
around it is regenerated.

Three things make that work on a real form rather than only a synthetic one:

**It is not always in Main.** This tool writes it into `Main`, beside the config
it belongs with, but the existing forms keep it in `Helper_Functions`. Searching
only where we put it silently dropped a real block, so `findCustomSaveValidation`
checks Main, then Helper_Functions, then anything else in the tree. Export moves
it to Main and leaves no copy behind.

**It is not stored as a string.** Acrobat writes a long script as a **Flate
compressed stream**, which is how both example forms store theirs, so reading
only PDF strings returned nothing for exactly the forms with code worth keeping.
`readDocumentScripts` decodes streams through pdf-lib's `decodePDFRawStream`.

**Braces are counted, not matched by regex.** The block is nested `if` statements,
and a brace inside a string or a comment must not end it early, so the scanner
skips over quoted text and comments. An unbalanced body returns empty rather than
something truncated at the wrong place.

Checked against the real form: its 71 line, 2263 character block comes back
byte for byte, having moved from `Helper_Functions` into `Main`.

`CustomSaveValidation` ships empty when the form has none. It is per form and
`runBaseSaveValidationOnly` calls it unconditionally, so it has to exist either
way.

Tests **execute** the generated block rather than matching strings against it, so
a block that would not run in Acrobat fails here. One test runs the config and
the helpers together and asks `rowHas` and `getFlowId` what they see, which is
what Acrobat does when the form opens.

### Writing them in

Document-level scripts live in the catalog's `/Names /JavaScript` name tree, and
Acrobat runs them in tree order. A name tree is sorted by name, and
`Helper_Functions` sorts before `Main`, which is what makes the helpers defined
by the time Main calls them.

**pdf-lib's `addJavaScript` is not used.** It appends to the flat `Names` array
without looking at what is already there, so exporting a form that already
carries these scripts, which every form this tool exports does, would leave two
entries under one name. It also ignores a tree that uses `Kids`.

So `installDocumentScripts` collects every entry however the tree is shaped,
drops the two names this tool owns, adds the current versions, and writes one
sorted flat array back. Anything the tool does not own survives. Re-exporting
any number of times leaves exactly two entries, which a test pins.

### Button actions

Each button carries its entry point on `/A`, the mouse-up action:
`submitPhoneAuth();`, `submitDigitalSignature();`, `submitRemoteESign();`,
`submitPrintOnly();`. Written on every export, so a change here reaches every
form exported afterwards.

It is Acrobat's JavaScript, ES3 era, so no `let`, `const` or arrow functions. A
test compiles both files and rejects those, since a syntax error would otherwise
surface in Acrobat rather than here. Acrobat runs document-level scripts in name
order, so `Helper_Functions` is defined before `Main` runs.

The `//<CONFIG>` region in `main.js` is per form and will be generated. What is
in there now are defaults.

### Signer rows

A signer row is `Member{i}Name`, `Member{i}Signature` and `Member{i}SignDate`,
and a row carries **any subset** of the three. That replaces the three form wide
`SIGNER_ROW_HAS_*` flags with one generated table:

```js
var SIGNER_ROWS = [
    { name: true, signature: true,  signDate: true  },
    { name: true, signature: false, signDate: false }
];

var MAX_SIGNERS_ON_FORM = SIGNER_ROWS.length;
```

`rowHas(i, part)` and `anyRowHas(part)` replace the flags at each site. Keeping
`MAX_SIGNERS_ON_FORM` as a derived var means every existing loop is unchanged.

**All rows true reads exactly as the old flags did**, so this is a safe swap on
forms built before it rather than a migration. A test pins that.

Rows are numbered **1 to N with no gaps**. The designer will prevent a gap rather
than report one, so `Member3*` cannot exist without `Member2*`. Dropping parts
within a row is fine and is not a gap; dropping the last part of a row deletes
the row.

Rows cap at **6**, which is `ESIGN_SLOT_COUNT`: the FileOptics Org eSigner list
in FO tag element 12 is a fixed width slot list that wide. A test asserts the
designer's cap and that constant are the same number, because if they drift,
forms get built that silently truncate on submit.

`Member{i}Name` is a dropdown whose options are built at run time from DNA data,
with two value shapes — Person uses the signer index, Org packs
`num<>name<>email`. So it has no `/Opt` at design time and must not be flagged
for missing options.

### Signer validation

Most of the validation never knew about rows. `flagError` and `clearAllRequired`
walk `this.numFields`, `runBaseSaveValidationOnly` walks `SAVE_VALIDATION_FIELDS`
by name, and `LoadValidation` walks name and label pairs. Mixed row shapes cost
them nothing.

**Phone Auth is the only path that wants a hand signature**, and it is the only
one where nobody signs electronically. The others go the other way:

| path | manual signature |
| --- | --- |
| Phone Auth | required, via `validateManualSignatures` |
| Remote eSign | `wipeManualSignatures()`, cleared |
| Digital Signature | `wipeManualSignatures()`, cleared |
| Print | `SaveValidation()` only, not checked |

So the member signs by hand and staff authorises the identity by phone, and the
electronic paths clear the signature because the e-signature replaces it.

A row is checked when it has a signature field, **row 1 always** and later rows
once a name is picked in that row's dropdown. Dates go with it, since Phone Auth
passes `includeDates` true.

A row with a **sign date but no signature is skipped, date included**, on
purpose: `enableSignerRows` auto fills `Member{i}SignDate` from
`PRIMARY_SIGN_DATE`, so the date is not something a person types, and a row with
no signature field has nothing manual to check.

### Field scripts

Generated per field, in [`fieldScripts.js`](src/starter/fieldScripts.js), and
written on every export.

The old forms did this at load time, walking every field and calling `setAction`.
That pass, `injectErrorFlagClearing`, is **gone**. It was only ever safe to run
once: running it again flattened the signer dropdown scripts back to the generic
line, which is why the form that had real dropdown scripts had the call
commented out. Generating at export removes the hazard.

Two scripts come out of it.

`clearRequiredOnBlur(name)` is the generic one, taking the red highlight off a
field once it has a value.

`signerNameOnBlur(index, row)` is the signer dropdown, taken from a form the
business confirmed is correct. Picking a name reveals that row's signature and
date, clearing it hides them again:

```js
if (getSelectedText("Member1Name") !== "") {
    this.getField("Member1Name").required = false;
    this.getField("Member1Signature").display = display.visible;
    this.getField("Member1Signature").readonly = false;
} else {
    this.getField("Member1Signature").display = display.hidden;
    this.getField("Member1Signature").readonly = true;
    this.getField("Member1Signature").required = false;
}
```

**This is how rows past the first get turned on.** `enableSignerRows` enabling
only row 1 is not a quirk, it is the design: every other row is revealed by its
own dropdown.

The row's shape is known when the script is generated, so only the parts the row
carries are written and nothing checks a flag at run time. A row with no
signature and no date has nothing to reveal, so the `else` is left off. A row
with no dropdown gets no script.

### Who gets which

| | script |
| --- | --- |
| `Member{i}Name` | the signer dropdown one |
| other text, checkbox and dropdown fields | the required-clearing one |
| system fields | **none**, they are read-only and filled by code, so nothing flags them |
| buttons | none, a pushbutton has no value to clear |

Written to `/AA /Bl` on **every widget**, since OnBlur is an annotation entry, so
a name placed twice carries it on both. That matches the existing forms, where
one name shows up as `Annot1` and `Annot2`.

Only the `Bl` entry is ours. `Format` and `Keystroke`, which this build does not
write, are left exactly as they were, so the date formatting on an imported form
survives.

They are regenerated on every export like everything else, so a field that is no
longer scripted **loses** the one it had. Checked against the real form: all 78
fields end up exactly as the rule says, with the signer dropdown carrying the
per-row script and no system field carrying anything.

### Org eSigner list

`prepareOrgESigners` spelled out `signerCtr` 1, 2 and 3 by hand and left
`eSigners` empty for 4 or more, which was a live bug. It is now built:

```js
function buildOrgESignerList(signerCtr) {
    if (signerCtr < 1) return "";
    var filled = Math.min(signerCtr, ESIGN_SLOT_COUNT);
    var parts = [];
    for (var i = 1; i <= ESIGN_SLOT_COUNT; i++) {
        parts.push(i <= filled ? String(i) : "");
    }
    return parts.join(",");
}
```

Tests pin the three original cases exactly and cover 4 through 6.

Worth confirming with whoever owns FileOptics: the Person path builds a list
`MAX_SIGNERS_ON_FORM` wide with no padding, and uses the dropdown's export value
rather than the row position. The two paths disagree on both width and meaning,
which is either tolerated, a Person side bug, or belt and braces on the Org side.

## Notes

Every field has a free text `note`, independent of any flag — use it on
anything worth explaining. It is required only when Custom Save Validation is
in play.

Notes live in the requirements JSON, not in the PDF's own fields, so they travel
with the file via the embedded JSON but never alter the AcroForm.

## DB field list

`public/dbFields.json`, an array of `{ identifier, label }`:

```json
[{ "identifier": "CUSTNAME", "label": "Customer Name" }]
```

Ships with ~37 placeholder entries. Swap the file for the real list, no code
change needed. Duplicate and blank identifiers are dropped on load.

This list, the system field list and the signing buttons are all the same shape:
entries carrying an `identifier`, deduplicated on the trimmed identifier with
the first winning, indexed by it, and membership derived from the name rather
than stored on the field. That rule lives once, in
[`src/core/identifierList.js`](src/core/identifierList.js), because it decides
which names the tool recognises and the lists drifting on it would be a silent
failure downstream.

## Opening a PDF

Three cases, in priority order:

1. **Has embedded requirements JSON** — loaded as is. Full fidelity round trip,
   including internal ids.
2. **Has an AcroForm but no JSON** — field definitions are rebuilt from the real
   widgets: name, type, rect, page, read-only flag, and the font read back out
   of the field's `/DA` string. Notes and validation flags are never inferred,
   they exist only in the JSON. These are marked **imported**, and the property
   panel says so, because they are inferred rather than exact. A font that is not
   one of the recognised families falls back to the default rather than being
   guessed at.
3. **Neither** — flat PDF, empty field set.

Pushbuttons, signatures and list boxes are not modelled. They are skipped on
import and passed through export untouched.

### The config only travels in the JSON

`formType` and `productCodes` are not recoverable from a PDF's
field data, so case 2 above loses them and case 1 does not. The values do appear
in Main's `//<CONFIG>` block, but that block is **never read back**. Nothing in
this tool parses JavaScript out of a PDF, and nothing should: reading it would
mean trusting file content to describe the form, and running it is out of the
question. The JSON is structured, validated by `createConfig` on the way in, and
written twice.

That makes the JSON the single copy of the config, which is why the round trip
is pinned by tests rather than left to the embed working by inspection. A bad or
missing config falls back to defaults.

Recovering the config from a form this tool never wrote is **not supported and
not planned**. Set the two values in the config panel instead.

## Export

`Export PDF` writes `<name>.pdf`, a valid AcroForm, with the requirements JSON
embedded twice: in the document catalog under `/PdfRequirementDesigner`, and as
an attachment named `form.fields.json` visible in Acrobat's attachment pane.
`Export JSON` writes the same JSON on its own.

Export always rebuilds from the originally uploaded bytes, so exporting
repeatedly cannot accumulate drift.

The tool owns exactly ten things on a field: name, type, rect, page,
read-only, visibility, font, alignment, wrapping, and the embedded JSON. Everything else already in the PDF is
preserved — border and background style, tab order, and any property this build
does not model. A field that only moves keeps that styling; a field whose type
changed is rebuilt. `NeedAppearances` is set so viewers render filled values.

## Yes/No checkbox pairs

The on-state of a checkbox lives on the **widget**, not the field, so two
placements of one name can carry different values. That is one field with two
boxes and one answer, which is how the existing forms ask a yes or no question:

```
ContractWithCompany -> [/No @145,374]  [/Yes @361,374]
```

Each placement's export value names its own widget's on-state. Two placements
sharing a value is the other case, one box shown twice, ticked together.

This was wrong until it was checked against a real form. Only the first widget
was renamed and the rest kept pdf-lib's default `/Yes`, so asking for `Yes, No`
produced `/Yes, /Yes` and the question could only ever answer yes. It looked
right in the designer and was wrong in the PDF. Radio options always named their
own on-state; checkboxes now do the same.

## Repeated names

A name used more than once is one PDF field with a widget per placement, the
same model Acrobat uses: every placement shares a single value, and filling it
once fills them all. Acrobat shows these as `NAME#0`, `NAME#1` in its Fields
panel, but that suffix is only its UI labelling — the stored field name has no
suffix, so name matching downstream is unaffected.

The field list follows Acrobat's two shapes. A **radio group** is nested under
its name, with each option labelled by its export value, because the options are
genuinely parts of one field and the value is what tells them apart. **Any other
repeated name** stays a flat row with a `#0`, `#1` suffix, since a checkbox
placed twice is still just a field placed twice. The numbering is display only
and runs across the whole document, because one field's placements can sit on
different pages.

Some settings live on the widget and can differ per placement (position,
visibility, border and background). Others live on the field and are shared
(value, type, read-only, font). Where placements disagree on a shared setting,
any read-only placement makes the whole field read-only, and the first
placement wins on font.

Reopening a form keeps every placement, and placements are moved rather than
rebuilt where possible, so per-placement settings this build does not model
survive a round trip.

## Field and widget structure

The PDF spec lets a field that has a single widget merge the two into one
dictionary, and Acrobat does exactly that, so `/T` and `/FT` sit directly on the
annotation. pdf-lib always keeps them apart, field as parent and widget as kid.

That difference matters downstream. A filler that walks page annotations and
reads the name and type straight off each one, which is the usual way, sees
nothing in the split shape. So export merges single-widget fields to match
Acrobat.

A field with several widgets cannot be merged, since one field genuinely owns
them all. Repeated names and radio groups stay split, and any reader handling
them has to resolve `/FT` up the `/Parent` chain and write `/V` to the field
rather than the widget.

## Coordinates

The likely source of bugs, so it is isolated and tested.

PDF user space is y-up from the bottom-left of the **CropBox**, which is not
always the MediaBox and does not always start at 0,0. The browser is y-down from
the top-left. Pages can also carry a `/Rotate` of 90, 180 or 270.

- All rects are stored in PDF user space, as `{ x, y, width, height }` with `x,y`
  at the lower-left corner.
- Conversion happens only at the display boundary, in
  [`src/core/coords.js`](src/core/coords.js): `pdfRectToView` and `viewRectToPdf`.
- Zoom is a display concern. It scales on the way out and divides on the way in,
  and never touches a stored value.

`tests/viewport-parity.test.js` builds real PDFs with rotations and offset
CropBoxes, opens them with pdf.js, and asserts our transforms agree with the
viewport pdf.js actually renders. Self-consistent math is not enough, it has to
match what is on screen.

## JSON format

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-02T00:00:00.000Z",
  "sourceFileName": "application.pdf",
  "markers": [
    {
      "id": "3f91...",
      "page": 0,
      "rect": { "x": 430, "y": 512, "width": 40, "height": 18 },
      "role": "Branch manager",
      "note": "Both copies."
    }
  ],
  "fields": [
    {
      "id": "0b7d...",
      "name": "CUSTNAME",
      "type": "text",
      "editable": true,
      "page": 0,
      "rect": { "x": 100, "y": 650, "width": 220, "height": 18 },
      "font": { "family": "Helvetica", "size": 10 },
      "exportValue": "",
      "options": [],
      "note": "Legal name, must match the policy exactly.",
      "customerFacingName": "Account Holder",
      "hidden": false,
      "alignment": "left",
      "multiline": false,
      "loadValidated": true,
      "saveValidated": false,
      "customSaveValidated": false
    }
  ]
}
```

`page` is zero-based. `loadAttempted` is deliberately absent, it is derived from
the DB field list at load time. A document whose `schemaVersion` is not the
current one is rejected rather than guessed at.

`markers` was added **without a version bump**, and is written on every document
whether a form uses them or not. They are an optional array that nothing in the
PDF depends on, so a document written before them reads with none, and an older
build reading a newer one exports the same form with a thinner requirements
sheet. A bump would have rejected every file already written instead.

## Field types

Four types, matching what the downstream filler handles:

| Type | PDF | Carries |
| --- | --- | --- |
| Text | `/Tx` | font |
| Checkbox | `/Btn` | export value, defaults to `Yes` |
| Radio | `/Btn` + Radio flag | one export value per option, `Choice1`, `Choice2`, … |
| Dropdown | `/Ch` + Combo flag | option list, font |

A field's type is chosen with the toolbar's Draw buttons before it is placed and
is fixed once drawn. The property panel shows it but does not change it.

### Export values

A checkbox or radio option writes an **export value**, and the filler compares
the database value against it exactly. Get it wrong and the field silently never
fills, so the tool treats it the way it treats names:

- Acrobat pre-fills these, and so does this tool: a checkbox gets `Yes`, and
  each radio option gets `Choice1`, `Choice2` and so on, taking the lowest
  number not already in use so a new option never collides. Clearing one is
  still an error, since the field could never fill without it.
- Only letters, digits, dot, dash and underscore are allowed. Anything else is
  escaped as `#xx` inside the PDF, and the filler would compare against the
  escaped form and never match.
- Two options of one radio group **may** share a value. That is Acrobat's
  radios-in-unison behaviour: the same choice offered in more than one place,
  selected together. When it happens, export sets the RadiosInUnison flag, which
  is what tells a viewer to treat clicks that way rather than only the drawn
  appearance agreeing.

### Radio groups

A radio group is one field whose options are its widgets, so each option is a
separate placement sharing the group's name, the same shape a repeated name
takes. The chosen option is whichever widget's on-state matches the field value.

pdf-lib names those on-states by position and keeps the labels in a separate
`/Opt` array. Acrobat names each on-state after its export value, and a filler
reads that name, so export renames them to match Acrobat and drops `/Opt`. The
Radio and NoToggleToOff flags are set as Acrobat sets them, so a chosen option
cannot be cleared by clicking it.

### Dropdowns

`/Ch` covers both dropdowns and list boxes. Only the dropdown, meaning `/Ch`
with the Combo flag, is modelled. A list box is left alone rather than being
silently converted.

An option carries two things: the **value** written into the PDF and the
**label** the reader sees. They are usually the same, and a bare line in the
options box means both. Where they differ, write `ON = Ontario`, or paste two
columns from a spreadsheet, since a tab separates them too.

`/Opt` takes either form and so does this tool: a bare string where the two
match, a `[value, label]` pair where they differ, which is what Acrobat writes.
Both are read back on import, so an existing form's paired options survive a
round trip rather than being flattened.

Two options cannot share a stored value, since it would be ambiguous which one
a written value meant. A repeat is dropped.

## Alignment and wrapping

Text fields and dropdowns carry an **alignment**, written as the `/Q` quadding
entry: left, centre or right. Everything defaults to left, matching both the PDF
default and Acrobat.

Text fields also carry **multiline**, field flag bit 13. Without it a long value
is clipped to one line however tall the box is, which is why `DNA_REQ` and
`FORM_MESSAGE` default to it. A dropdown shows one line by definition, so it
aligns but does not wrap.

Both are field level, like the font, so every placement of a name shares them.
That is how Acrobat models them, and matching Acrobat is the point.

Neither is a format script. They are plain field entries read whenever the
appearance is generated, so they work the same whether Acrobat regenerates them
or anything else does. Acrobat's Format tab, the one that makes a field numeric
or currency, is JavaScript in `/AA` and is deliberately not modelled: a filler
that writes a value directly never fires those events, and not modelling `/AA`
means an imported form's existing scripts survive export untouched.

## Font

Text fields carry a font family and size, defaulting to **Arial 10** to match
the internal standard. Checkboxes render no text, so they have no font control.

`family` stores a standard PDF font name, not the label shown in the UI. Arial
is not one of the 14 fonts every PDF reader supports without embedding, but
Helvetica is, and the two are metrically identical — Acrobat and Windows
readers render Helvetica using Arial. So storing `Helvetica` gets Arial on
screen with no font file to embed and no font licensing to worry about. Times
New Roman and Courier New map to `Times-Roman` and `Courier` the same way.
Adding a family that is not in that standard set would mean embedding a real
font file, which is a licensing question, not just a code change.

The standard is a default, not a lock — any field can be changed. **Enforce
Font Standards** in the toolbar puts every field in the document back to Arial
at the size typed in the box beside it. The size is typed rather than fixed at
10, because the size a form is standardised on is a per form decision; the
button does nothing until a size between 4 and 72 is in the box.

**Suggested Size - X** beside that box is read off the printed page, not off the
fields. `pageText.js` takes every text item pdf.js reports, rounds its size to
the nearest half point, and returns the median weighted by character count. The
weighting is the point: a PDF splits text wherever it likes, so a heading is one
item of six characters and a paragraph is one item of four hundred. Counting
items would let a few headings outvote the body text. Field `/DA` is deliberately
not consulted — on a form nobody has standardised yet it is whatever Acrobat was
set to that day, which is the question being asked, not the answer. A scan with
no text layer gets no suggestion. Across the example forms it reads 7, 9, 10 and
11, matching the body text of each.

### Only the font part of /DA is written

A `/DA` string is a fragment of content stream, `/Arial 10 Tf 0.898 0.133 0.215
rg`. Only the `Tf` operator names the font; the rest sets the colour, and on a
form drawn in Acrobat the colour is doing real work.

Export used to rebuild the whole string from the font, which meant black. On the
real form that turned `DNA_REQ`, `eSIGN_FAILED`, `SUBMIT_FAILED` and
`VALIDATE_REQ` from red to black, `SUBMIT_SUCCESS` and `eSignLBL` from green to
black, and moved all 63 Arial widgets onto a `/Helvetica` resource the document
did not previously use. `VALIDATE_REQ` reads "Fields highlighted in RED are
required", in black. The four status boxes have since become one `FORM_MESSAGE`,
but a form drawn before that still carries them, and this is why importing one
keeps their colour.

So a field that came from the source PDF keeps the `/DA` it arrived with unless
the font was actually changed, in which case only the `Tf` operator is replaced
and every other operator is left alone. A field this tool creates has no prior
appearance to respect and gets the plain black default.

A consequence worth knowing: an unrecognised family reads back as the default,
so a Calibri field shows as Arial 10 in the panel. Nobody chose that, so it is
not written back out. Change the font on such a field and it does become
Helvetica, because that is a change someone asked for.

Alignment is different, and is written explicitly. It is a property the tool
models and the panel exposes, so `/Q` is owned the way `/AA /Bl` is.

On export, each field's font is written into its `/DA` string and every family
used is embedded and registered in the AcroForm's `/DR` dictionary. That
registration matters: with `NeedAppearances` set, the viewer builds each field's
appearance at render time and resolves the font named in `/DA` against `/DR`.
pdf-lib does not populate `/DR`, so [`pdfExport.js`](src/core/pdfExport.js) does
it by hand, merging alongside whatever the original PDF already had.

## Downstream filler

The separate application that fills these PDFs walks each page's annotations,
reads the field name and type off the annotation, and writes the value. Verified
against it directly, with pypdf, using the PDFs this tool exports:

| Field type | Fills today |
| --- | --- |
| Text | yes |
| Checkbox | yes |
| Dropdown | yes |
| **Radio group** | **no, see below** |

Text, checkbox and dropdown work with the filler exactly as it stands, because
export merges a single-widget field into one dictionary the way Acrobat does, so
`/T` and `/FT` sit right on the annotation.

A radio group cannot be merged. One field genuinely owns several widgets, so its
name and type only exist on the parent. The same is true of any name placed more
than once. Filling those needs three changes, not made yet:

1. Resolve `/FT` up the `/Parent` chain, the way the name already is. Read
   widget-only, it comes back `None` for a radio group and every branch is
   skipped.
2. Write `/AS` to the **widget** and `/V` to the **field**. A value set on a
   widget does not register, and unison needs one value to light two widgets.
3. Do not clear `/V` inside the widget loop. Setting it per widget means a later
   non-matching option overwrites an earlier match, so a three option group only
   works when the answer happens to be last.

The verified shape, tested filling two independent groups plus a unison pair:

```python
def resolve_field(widget):
    #walk up to the dictionary that owns this widget
    #same object when Acrobat merged them, the parent when it did not
    field, guard = widget, 0
    while field.get("/T") is None and field.get("/Parent") is not None and guard < 64:
        field = field["/Parent"].get_object(); guard += 1
    return field

def get_inherited(node, key):
    #FT and Ff can sit on a parent field node
    guard = 0
    while node is not None and guard < 64:
        if key in node: return node[key]
        parent = node.get("/Parent")
        node = parent.get_object() if parent else None
        guard += 1
    return None

def widget_export_value(widget):
    #the on state name in this widget's own appearance dictionary
    ap = widget.get("/AP")
    if ap:
        normal = ap.get_object().get("/N")
        if normal:
            for key in normal.get_object():
                if key != "/Off": return key.lstrip("/")
    return None
```

Then, per widget: `field = resolve_field(widget)`,
`field_type = get_inherited(widget, "/FT")`, and for `/Btn`, set `/AS` on the
widget, `/V` on the field, tracking which fields have already been switched on
so a later option cannot clear them.

Until that lands, radio groups export correctly and are valid in Acrobat, they
just come back empty from the filler.

### Long text

Not made yet. Text draws at the size in the field's `/DA`, so a long value is
cut off. [`filler/fit_text.py`](filler/fit_text.py) steps the size down in half
points until the value fits, never above the designed size and never below 6.
Auto size and comb fields are left alone. One call in the `/Tx` branch, after
`/V` is set:

```python
fit_text_to_widget(field, value, writer)
```

### ENVIRONMENT

The filler writes the `ENVIRONMENT` system field on every fill, `PROD` from the
production filler and `TEST` from the test one. It is not a DB field, so the
value comes from the filler's own config rather than a lookup.

The starter code reads it at submit time. `PROD` sends the `FO`, `ES` and `DS`
flow ids and uses the member emails. Anything else, blank included, sends `TFO`,
`TES` and `TDS` and prompts for a test email address.

### PRIMARY_MEMBERSHIP_TYPE

The filler writes `P` for a person membership and `B` for an organization. It
replaced `IN_PERSNBR` and `IN_ORGNBR`. The starter code reads it when the form
opens and again when building the Remote eSign signer list. `P` is a person;
anything else, blank included, is an organization, as a blank `IN_PERSNBR` was.

## Keyboard

| Key | Action |
| --- | --- |
| Drag on the page | Draw a field of the type selected in the toolbar |
| Click | Select |
| Ctrl/Cmd + click | Add or remove one row from the selection |
| Shift + click | Select the run between the last row clicked and this one |
| Up / Down | Move through the field list, in the order it is drawn |
| Shift + Up / Down | Extend the selection while moving |
| Delete / Backspace | Delete selection |
| Ctrl/Cmd + D | Duplicate selection, on the page it is already on |
| Ctrl/Cmd + C | Copy selection |
| Ctrl/Cmd + V | Paste onto the page that is open |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z, Ctrl + Y | Redo |
| Escape | Clear selection |

Copy and paste use the app's own clipboard, not the system one, so copying a
field never costs you what you had on the system clipboard. With nothing
selected, or nothing copied, the browser's own copy and paste are left alone.

**Paste is how a placement reaches another page**, which duplicate cannot do:
there is no page control on a field, so a box wanted again further on is a copy,
a page turn and a paste. Pasting onto the page it came from offsets the copy so
it does not hide behind the original; pasting onto any other page keeps the
coordinates exactly, since the same spot further on is the point. A submission
button is never pasted, it appears at most once. Fields and markers paste in one
undo step.

Undo covers the fields and the config, not the page, the zoom or the selection.
A drag undoes as the one move it looked like, and a run of typing in one box as
the one name. Opening a PDF starts the stack over; importing JSON does not, so a
sidecar loaded onto the wrong form comes straight back off.

Unlike Delete, it works while the cursor is in a text box. Every box here is a
controlled React input, so the browser's own undo has nothing of its own to put
back and would only leave the box and the field disagreeing.

### One name, more than one font

`/DA` is written on the **widget**, not the field, because that is where a PDF
allows it to differ. A trust form in the example set shows `PRIMARY_MEMBER_NUMBER`
at Arial 10 in the body and Courier 9 in a footer, both under the one name, and
another shows a name at 10 point in a box and 8 point in a repeat. Collapsing
those to one font forced 8 point text into boxes drawn for it and 9 point
monospace into a proportional face.

The model already carried a font per placement; only export flattened it.

This turned up a second thing. Import walks each page's `/Annots`, while
`getWidgets` reads the field's `/Kids`, and **the two orders are not the same**:
that form has a field whose first two widgets are swapped between them. Pairing
placement to widget by position therefore handed a placement to the wrong widget.
It went unnoticed while every widget of a field looked alike, because swapping
two identical boxes changes nothing. `alignWidgets` matches on rect and page
instead, and falls back to order for a placement the designer has since moved.

### Choosing what is on screen

The four groups, Standard, System, Signers and Submission, are **independent
toggles rather than tabs**. Every field is in exactly one, so any subset is a
legible view and All is simply all four on. That is what makes "the fields this
form is about, with the signer rows, without the system plumbing" reachable,
which the old exclusive tabs could not express.

Turning every group off shows nothing. That is a legible state, not a forbidden
one, and All is the way back.

`fieldScope` in `src/core/fieldTone.js` decides the group, next to `fieldTone`
which decides the colour. Related questions, different answers: the eSign label
and code box are special fields but belong to the Remote eSign button, so the
scope claims them for Submission while the tone still paints them as special.

### Issues filter the list

Every issue carries the ids of the fields it counted, so clicking one narrows the
list to exactly those. A count on its own means going hunting through eighty rows
to find the three it meant, and the filter beats the scope tabs while it is on,
since the point of clicking is to see what the issue named wherever those fields
live. It clears itself when the issue stops holding.

An issue with nothing to name is not clickable. A missing signer row is the only
one: the whole complaint is that the row is not there.

A name outside the DB field list is **not** an issue. Plenty of fields are typed
into by hand and never filled by the downstream filler, so counting them put a
number on the panel that was healthy on every form.

### Working on more than one field

Setting the same validation flag on forty fields one at a time is the bulk of the
work on an imported form, so the list takes a multiple selection and the property
panel gives way to a bulk bar showing how many of the selected fields already
carry each flag.

Only the flags worth setting in bulk are there. An Error Message Field Name and a
note are per field by nature. Custom Save Validation needs a note each, so it can be
cleared from the bulk bar but never set.

Bulk edits still go through `reconcileField`, so a flag that cannot stand on a
given field comes straight back off rather than being written and quietly
ignored. Load Validation cannot stand on a name the DB list does not have, and
the bulk bar says how many of the selection that applies to before you press it.

## Tests

```
npm test              # 624 unit and integration tests, node
npm run check:browser # 130 checks driving the real UI in headless Chrome
```

`tests/formHooks.test.js` runs the generated scripts through `node:vm`, one
program per document script in a shared global, which is how Acrobat runs them.
That is the only way to prove a hook fires rather than merely that its call site
exists, and the only way to prove the naming rule: concatenating the scripts
instead would hoist every declaration into one scope and a late sorting script
would appear to work. It also covers the smallest real form, one offering no
signing channel at all.

`tests/realForm.test.js` round trips **every PDF in `example forms/`** and
asserts, one property at a time, that nothing changed: types, field and annotation flags,
values, options, on-states, rects, MaxLen, border and appearance dicts, the
default appearance, and the Format and Keystroke scripts. The synthetic fixtures
cover each behaviour in isolation; this one asks whether a form the business
actually uses survives, which is how the `/DA` colour loss was found.

`npm test` also parses `check.jsx` and `App.jsx` with esbuild. Both are one long
scope, so a name declared twice is a SyntaxError that stops the module loading,
and the browser runner would otherwise sit for two minutes and time out with
nothing to show. Parsing names the line in a second instead.

The browser check needs the dev server running (`npm run dev`, it defaults to
5173, which is what the runner points at). It drives the actual React app: loads a PDF, verifies pdf.js
painted real content, draws and drags fields on both an upright and a rotated
page, and asserts the stored rects in PDF user space. It talks to Chrome over
the DevTools protocol using node's built-in WebSocket, so there is no browser
automation dependency.

Set `CHROME_PATH` if Chrome is somewhere unusual. Edge works too.

## Dependencies

pdf.js (Apache-2.0) for rendering, pdf-lib (MIT) for reading and writing
AcroForm fields, React and Tailwind (MIT). The full shipped tree is MIT,
Apache-2.0, 0BSD and Zlib only. No iText, PDFtk, PSPDFKit/Nutrient or Apryse.

## The old submission button

Forms predating the named channels carry a single pushbutton called `Send to
FileOptics`, with its logic inline in the widget's own `/A` action chain rather
than in a document script. Three of the eight example forms are that shape, and
they are also the three with no signer rows and no eSign pair.

It is a **print button under the old name**. Its two chained actions validate,
set `SUBMITTED_TO_FO` and the admin FO tag, lock every field, hide the button
and print, which is `submitPrintOnly` step for step. So `PrintButton` covers it
and those forms convert without a new channel.

Nothing here supports the old shape. An unrecognised pushbutton is skipped on
import and passed through export untouched, so such a form still works, it just
is not something the designer can place.

Comparing the two turned up a real bug in `submitPrintOnly`. It hid the signing
buttons through `setFileOpticsButtonsState`, which walks
`FILEOPTICS_BUTTON_FIELDS` and deliberately excludes `PrintButton`, so the print
button stayed visible and printed onto the paper copy. It now hides itself
first, which is what every old form did.

## Form hooks

A form's bespoke code lives in **its own document-level script**. Export
replaces `Helper_Functions` and `Main` and nothing else, so that script survives
untouched already. All the generated code has to provide is somewhere to call it
from:

| hook | where it runs |
| --- | --- |
| `CustomAfterValidation()` | in `Main`, once every load check has passed, before `disableAllSigners` |
| `CustomAfterLoad()` | last thing `Main` does, **after** `setFileOpticsButtonsState` |
| `CustomBeforeSubmit()` | in all four submit handlers, once validation has passed |

Plain functions, the same shape as `CustomSaveValidation`. The one difference is
that `CustomSaveValidation` is emitted into `Main`, empty when the form has none,
so it can be called bare. These are never emitted, so **every call site guards
with `typeof`**: a bare reference to a name nothing declared is a
`ReferenceError`, and `typeof` is the only operator that tolerates one.

No editor is needed. The code is written in Acrobat, the same place the fields
are drawn and formatted, and this tool never touches it.

### The script has to sort before Main

Acrobat runs document scripts in **name order**, and `Main()` is called at the
bottom of the `Main` script. So a script defining these has to have run by then:

| name | | |
| --- | --- | --- |
| `Form_Custom` | F < M | runs first, hooks fire |
| `ZZ_Custom` | Z > M | runs after `Main`, hooks never fire |

Getting this wrong fails **silently**: no error, the code is preserved, it simply
never runs. Import reports a script that sorts too late for exactly this reason,
and `tests/formHooks.test.js` proves it by running the scripts in name order and
showing the hooks do not fire.

`CustomAfterLoad` has to run after the buttons are shown or a form hiding a
signing channel would be undone, which is what the CUMIS form does. Positions
were taken from where the example forms already put this code.

**Hooks take no arguments.** What `Main` worked out is in the run time globals
below, read the same way the config block already is, so adding a new decision
reaches every form without changing a single hook.

| global | |
| --- | --- |
| `IS_PERSON` | person or org membership, from `PRIMARY_MEMBERSHIP_TYPE` |
| `SIGNER_COUNT` | signers found by `PersonSetup` or `OrgSetup` |
| `JOINT_POPULATED` | whether `PopulateJointData` ran |
| `CURRENT_AUTH_TYPE` | the channel, during a submit |

They sit outside the `//<CONFIG>` markers because they are worked out rather
than generated. A context object passed as a parameter was the other option and
was rejected: a form's code already reads `MEMBERSHIP_TYPE` and
`MAX_SIGNERS_ON_FORM` as globals, so a parameter would have meant two
conventions for reaching the same kind of thing.

## Code the form has and the starter does not

Export rewrites `Helper_Functions` and `Main` whole. Import says so plainly on
any form that carries them, and separately names the functions the starter code
has no equivalent for.

It names the hooks too. Saying the code will be lost without saying where it
can live instead is half a warning, and the answer is always the same: move it
to its own document script and call it from `afterValidation`, `atEnd` or
`beforeSubmit`.

The blunt warning is deliberate. Telling apart a line that is bespoke from one
that is an older version of the same flow needs guesswork: an older form differs
from the current starter in dozens of places that mean nothing. A detector that
guessed would misreport, and a warning people learn to ignore is worse than one
that states the plain fact. Named functions can be reported exactly, so those
are, and nothing else is inferred.

Preserving the bodies would not save them. On every example form the calls come
from `Main` or from a submit handler, both of which are regenerated, so a kept
definition would sit there uncalled. `CustomSaveValidation` only survives because
`runBaseSaveValidationOnly` calls it by name from code this tool writes: there is
a socket waiting for it. Nothing else has one.

So the warning is deliberately detection and not accommodation. What it is for is
deciding which general rule the function is an instance of, and building that.
Five of the eight example forms carry such code:

| general rule | the functions it would cover |
| --- | --- |
| optional sub-document gated by a field | `buildFormID`, `setCreditConsentPageVisibility` |
| a field derived from the selected signer | `populateDobFromSignerDropdown`, `populateApplicantDropdown` |
| a signing channel conditional on a field | `updatePhoneAuthButtonState` |
| a two line overflow list | `DistributeNames` |
| an extra manual signature field | `wipeStaffSignature` |
| none, it is a shared utility | `formatToDDMMMYYYY` |

The two on the trust form are the tell: both are driven by the same four consent
fields, one appending a token to the FO form ID and the other showing a page.
They are two views of one idea, an optional sub-document gated by a field, so
declaring that once as data would generate both.

`injectErrorFlagClearing` is on every form and is not reported. It walked every
field at load time setting its OnBlur; those scripts are generated at export now,
so it is retired on purpose.

## Reviewer comments are stripped on export

Draft forms are marked up in Acrobat and pick up sticky notes, highlights and
boxes. Those live in the same page `/Annots` array as the fields, so export
filters that array and says how many went.

`src/core/pdfComments.js` names what to **remove** rather than what to keep, so
an annotation type nobody thought about survives rather than being swept up.
`/Widget` is the fields and `/Link` is navigation, neither is a comment. A
`/Popup` is the note window and goes with its parent, or it is left pointing at
an annotation that is no longer there.

Until export they stay on the page, and a click on one opens its text, author,
date and replies. A drag that starts on one still draws a field. Comments sit on
top of fields and markers, and **Comments** in the toolbar hides them, both the
click and the ink, which is how to reach a field under one. They
are shown again whenever a PDF is opened. `tests/browser/commentEdges.js` builds a PDF
with a comment on every edge and corner for checking where the pop-up lands.

No form the business supplied carries one, so `example forms/` also holds a
copy of K_COV with four comments added by hand, which is what the round trip
runs against.

## The requirements workbook

`Export Requirements` writes an .xlsx in the shape the business already fills in
by hand, so the document people review is the one they know rather than a new
format to learn.

It is **its own module**, `src/core/excelExport.js`, reading the same serialized
document that goes in the JSON sidecar and nothing else. No pdf-lib, no live
field array, no reaching into the export path, so nothing it does can affect the
PDF. One direction only: this is a testing document, not a format to read back.

Layout is taken from the workbooks the business supplied, not invented. Columns
A to E are a band down the left holding the page pictures, the table starts at
column F, and the header reads `Field, Form Field, Load Validation, Save
Validation, Logic`.

### What is derived and what is left blank

| part | where it comes from |
| --- | --- |
| signing channel sections | the buttons placed. A channel not offered stays a bare heading, which is what the trust form does |
| test columns | the membership type. One column each for a person or org form, two for combined |
| field table | the fields, in reading order |
| the metadata block | the config, every row of it |

Nothing in that block is guessed. A filled in guess would be read as a checked
fact, so every row has a box or a checkbox in Config instead, a ticked box
reading Yes and a clear one No.

### The field table

Only the fields a person interacts with, which is the Standard and Signers
groups. System fields are plumbing and the submission buttons drive the signing
sections instead, which is why neither appears in the documents this is modelled
on. Only the system placement of a system name counts as plumbing: a second box
carrying that name was put on the form to show the value, so it earns a row like
any other field.

**One row per name.** A name placed more than once is one field carrying one
value, so there is one thing to test; two rows could be ticked Pass and Fail with
nothing to resolve the contradiction. The pages it appears on are listed instead.

`Field Name` is the column their documents never carried. Everything else is a
column they already have, and it is the only thing the downstream filler matches
on. It holds the PDF field name whether or not that name is in the DB list,
which is why the header states the fact rather than the intent.

**Form Field is left empty**, like the metadata rows. It is the label a member
reads beside the box, which only someone looking at the form can say. The
`customerFacingName` on a field is not the same thing: it exists to name a field
in an error message, and only load validated fields carry it, so filling from it
would populate a few rows and leave the rest blank while looking authoritative.

The name is **coloured by what kind of field it is**, by the same `fieldTone`
rule the canvas and the field list use, so a name reads the same colour in the
workbook as it does on screen: one for a name the DB list knows, one for a
signer or joint field, one for a custom name. A key is written above the table,
since nothing else on the sheet says what the colours mean, and each cell also
carries the meaning as a note.

Rows are lined up with the picture beside them. A field's distance from the top
of the page, scaled the way the picture is, decides which row it lands on, so
the table and the artwork stay in step down the page. Rows never run backwards,
and fields on one visual line take consecutive rows rather than being stacked
apart.

Initials markers take a row each, in the same reading order, and fill the same
columns. See [Initials markers](#initials-markers).

Save Validation is written `Yes`, or `Yes*` for a Custom Save Validation. That
star is their own convention for "depends on something, explained alongside",
and Custom Save Validation already insists on a note, so it lands in Logic.

### Reading order

Down the page then across, from the rects. Fields are gathered into bands by
their vertical centre, within half the height of the tallest box on the line,
because boxes meant to sit on one line rarely share a top edge: a signer row on
a real form has its name, signature and date within a point of each other with
heights differing by four. Sorting on the top edge alone interleaves the columns.

### The pictures

One per page, rendered by `src/core/pageImages.js` with
`AnnotationMode.DISABLE`, so the picture is the printed form with nothing laid
over it. Rasterising needs pdf.js and a canvas, so it happens in the browser and
the workbook builder takes the result, which keeps it testable in node.

The one exception is the initials markers, drawn on afterwards, because the
whole point of a marker is to show a place the printed form does not. They use
`convertToViewportRectangle` rather than arithmetic on the rect, so a page with
a `/Rotate` puts them where pdf.js actually drew it.

## What a built form declares about itself

A form that went through the old process states its own validation in `Main`:

```js
LOAD_VALIDATION_FIELDS = [["ACCOUNT_NUMBER", "Account Number"], ...]
SAVE_VALIDATION_FIELDS = ["txtAcct1", "Member1Name"]
```

That is the Load Validation flag, the Save Validation flag and the customer
facing label, all sitting in the file. Import **reports it and never applies
it**. Filling the requirements in from the form they are meant to specify would
leave a tester ticking Pass against inherited values, checking the form against
itself. So a person is told what the old form declared and decides what is still
true.

Nothing is executed. Both are arrays of string literals, read by counting
brackets and skipping comments, so a form whose list is built by a function
yields nothing rather than running it.

The DB list remark applies to Load Validation only, because `reconcileField`
gates that flag on the name being in the list and Save Validation stands on any
field. When some names are in the list and some are not, the missing ones are
named. When none are, that says more about the list than the form, so it is one
line rather than every name.

## Out of scope for this build

**Initial field values, apart from two.** The real form ships 15 fields carrying
a value, from constants like `VALID_ID` = `1` to per-form ones like `FORM_ID` and
`PACK_TYPE`. Only `FORM_ID` and `FORM_NAME` are set here, from Config. The rest
are the downstream filler's job, the same as the data line, and its list covers
the static ones too, such as `eSignLBL` = `Remote eSign Code:` and the
`DNA_REQ` message, which are captions rather than data.

The submit messages are the exception, and moved the other way. `SUBMIT_SUCCESS`
and `SUBMIT_FAILED` used to carry their text as a shipped value; one shared
`FORM_MESSAGE` cannot, since it has to say something different each time, so the
starter code now writes both. The strings are the ones all seven example forms
ship, so nothing a person reads has changed.

**Formatting, apart from one script.** Fields are drawn and formatted in
Acrobat, then imported here for their requirements, so whoever creates a field
owns its formatting. Export never writes a Format entry and only ever writes a
Keystroke on `eSign_Code`, the one field the tool places that Acrobat never saw.
A Format or Keystroke found on any other field was set by the person who drew it
and is carried through untouched, which a round trip test pins.

Both example forms agree: across 95 field level actions, `eSign_Code:Keystroke`
is the only Format or Keystroke entry either one carries. The date pictures on
`Date1` and friends sit on fields drawn in Acrobat, and `Member{i}SignDate`,
which this tool does place, carries none.

**Custom Save Validation authoring.** The block is bespoke per form and written
by hand in Acrobat. Export reads it out of the PDF and re-emits it byte for byte
so it survives, but the tool does not and will not offer a way to write one.

Suggested or automatic placement, fill preview, Excel import, tab
order UI, field format scripts beyond the above, calculations, list boxes, rich
text, and comb/maxlength. Tab order is set in Acrobat and survives export: page
`/Annots` order is preserved for every field that already existed, and new ones
are appended.

Also the downstream filler changes for radio groups and long text. Both are
specified and verified above, not made yet.
