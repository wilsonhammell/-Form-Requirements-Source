PDF Requirement Designer - standalone build
===========================================

This is the built app only. There is no source, no build tooling and no
package manager here, and nothing in this folder can install anything.

TO RUN
------
Double-click Start.cmd. A console window opens and the app opens in your
browser at http://127.0.0.1:8000/. Leave the console window open while you
work; closing it stops the app.

If Start.cmd cannot find a runtime, run whichever of these you have:
    python serve.py
    py serve.py
    node serve.mjs
Add a port number if 8000 is taken, e.g.  python serve.py 8080

WHY IT NEEDS A SERVER
---------------------
Opening index.html directly off the disk does not work - you get a blank
page. The app loads as an ES module and reads two JSON files, and browsers
block both over file:// for security reasons. serve.py exists only to give
the files an HTTP origin. It binds to 127.0.0.1, so it is reachable from
this machine only and not from the network.

It also fixes one MIME type. Python's default maps .mjs to text/plain, and
a browser will not run a module script served as text/plain, which would
leave the PDF renderer with no worker and no page would ever display.

You can also drop this folder into an existing internal web server instead
of using serve.py. The asset paths are relative, so it works from a
subfolder as well as from a site root. Just make sure that server sends
.mjs as text/javascript.

LETTING OTHER PEOPLE USE IT
---------------------------
By default this is your machine only - it listens on 127.0.0.1, which no
other machine can reach.

The better way to share it is to not run serve.py at all. This folder is
just static files, so it can be dropped onto an internal web server that
already exists and is already managed. Then people just open a URL and
need nothing installed, nobody has to leave a console window open, and
there is no new software to approve.

HOSTING.txt is written for whoever runs that server: what to set up, the
one MIME type that matters, and the list of things it does not need.

If you do want to serve it from your own machine, run:
    python serve.py --lan
(serve.ps1 is deliberately localhost only - binding wider needs
administrator rights on Windows, so use serve.py or serve.mjs for this.)
and other people use http://<your-machine-name>:8000/. Understand what
that does first:
  - There is no login. Anyone who can reach your machine on that port
    gets in. Nothing checks who is asking.
  - It only works while your machine is on, awake and running the script.
  - Windows Firewall will most likely prompt or block it.
  - It turns this from a local tool into a service on the corporate
    network, which is a different and larger conversation with security
    than the one described below.
Windows Firewall will block the port until a rule exists. From an
admin PowerShell, once:
    New-NetFirewallRule -DisplayName "PDF Requirement Designer" `
      -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow `
      -Profile Domain
To undo it later:
    Remove-NetFirewallRule -DisplayName "PDF Requirement Designer"

Other people need nothing installed - just a browser and the URL.

Check that it is allowed before you use it.

WHAT IT TALKS TO
----------------
Nothing. The app makes no outbound network calls. It reads dbFields.json
and systemFields.json from this folder and nothing else. PDFs you open stay
in the browser; they are never uploaded. Exports are ordinary browser
downloads.

CHANGING THE FIELD LISTS
------------------------
dbFields.json  - the DB fields that can be attached to a form field
systemFields.json - the standard system fields

Both are plain JSON in this folder and are read fresh on every page load.
Edit them and reload the browser; there is no rebuild step.

FOR WHOEVER HOSTS IT
--------------------
See HOSTING.txt.

FOR SECURITY REVIEW
-------------------
See CLEARANCE.txt. It lists every third party library in the build with
version and license, what runs where, what the app does and does not talk
to, and a SHA-256 for every file here. sbom.cyclonedx.json is the same
inventory in CycloneDX form for automated tooling.

CONTENTS
--------
CLEARANCE.txt               the security review pack
HOSTING.txt                 the ask for the server team
index.html                  the app page
assets/index-*.js           the app, React and pdf-lib
assets/pdf.worker.min-*.mjs the PDF renderer's worker
assets/index-*.css          styles
dbFields.json               field list (editable)
systemFields.json           field list (editable)
web.config                  IIS MIME settings, only used if hosted on IIS
serve.py                    local server, Python standard library only
serve.mjs                   same, for a machine with Node instead of Python
Start.cmd                   picks whichever runtime is present
