# Security policy

DrDoc processes files entirely in the browser. It has no backend and sends no file data anywhere. The Content-Security-Policy in `netlify.toml` limits network access to the site's own origin.

## Reporting a vulnerability

Please don't open a public issue for security problems. Report them privately through GitHub's **Security → Report a vulnerability** on this repository. Include steps to reproduce and, if possible, a sample file.

You'll get a reply within a week. Fixes are released as soon as they are ready.

## Scope

In scope: anything that could leak file contents off the device, run script from a crafted document, or bypass the password protection DrDoc applies.

Bugs in MuPDF itself should also be reported upstream to [Artifex](https://bugs.ghostscript.com/).
