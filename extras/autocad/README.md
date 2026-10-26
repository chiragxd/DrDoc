# Split a DWG into one file per sheet

`SplitSheets.lsp` saves every sheet (layout tab) of an AutoCAD drawing as its own DWG. Each file is a full working drawing: model space, layers, blocks, xrefs and viewports are kept, and only the other sheets are removed. Your original drawing is not changed.

It runs inside **AutoCAD for Windows**. It doesn't work in AutoCAD LT or AutoCAD for Mac. No AutoCAD? The free 30-day trial is enough.

## Steps

1. **Get AutoCAD.** Download the free trial of *AutoCAD* (not LT) from autodesk.com and install it. You'll need an Autodesk account; no payment is needed for the trial.
2. **Open your drawing** in AutoCAD and save it if you've changed anything.
3. **Load the script.** Type `APPLOAD` and press Enter, pick `SplitSheets.lsp`, and click **Load**. If a security warning appears, choose **Load Once**. Close the dialog.
4. **Run it.** Type `SPLITSHEETS` and press Enter. AutoCAD briefly opens and closes each copy while it works.
5. **Find your files.** A message shows where they went: a folder named `<your drawing> - sheets` next to the original, containing `<your drawing> - <sheet name>.dwg` for every sheet.

Repeat steps 2 to 4 for each drawing. The script stays loaded until you close AutoCAD.

## Good to know

- Each copy is cleaned with *Purge*, which removes definitions (block, layer and style names) that nothing in that copy uses any more.
- Running it again replaces the previous copies in the same folder.
- Xrefs keep pointing where they pointed before. If they use relative paths, keep the `- sheets` folder next to the original so they still resolve.
- If AutoCAD says it needs multiple-document mode, type `SDI`, enter `0`, and run `SPLITSHEETS` again.
