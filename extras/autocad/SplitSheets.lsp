;;; SplitSheets.lsp  (part of DrDoc)
;;;
;;; Saves every sheet (paper-space layout) of the open drawing as its own DWG.
;;;
;;; Each new file is a full copy of the drawing that keeps only one sheet, so
;;; model space, layers, blocks, xrefs and viewports stay intact. The original
;;; drawing is never changed.
;;;
;;; Usage:  APPLOAD this file, then type  SPLITSHEETS
;;; Output: a folder "<drawing> - sheets" next to the drawing, containing
;;;         "<drawing> - <sheet name>.dwg" for every sheet.
;;;
;;; Needs full AutoCAD for Windows (it uses ActiveX). Not AutoCAD LT or Mac.

(vl-load-com)

;; Replace characters Windows doesn't allow in file names.
(defun dd:safe-name (s / bad out ch i)
  (setq bad "\\/:*?\"<>|" out "" i 1)
  (while (<= i (strlen s))
    (setq ch (substr s i 1))
    (setq out (strcat out (if (vl-string-search ch bad) "_" ch)))
    (setq i (1+ i))
  )
  (setq out (vl-string-trim " ." out))
  (if (= out "") "Sheet" out)
)

;; Sheet names in tab order (left to right).
(defun dd:sheets (doc / lst)
  (vlax-for lay (vla-get-Layouts doc)
    (if (= (vla-get-ModelType lay) :vlax-false)
      (setq lst (cons (cons (vla-get-TabOrder lay) (vla-get-Name lay)) lst))
    )
  )
  (mapcar 'cdr (vl-sort lst '(lambda (a b) (< (car a) (car b)))))
)

;; In DOC, delete every sheet except KEEP, then purge unused definitions.
(defun dd:keep-only (doc keep / target doomed)
  (vlax-for lay (vla-get-Layouts doc)
    (cond
      ((= (vla-get-ModelType lay) :vlax-true))
      ((= (strcase (vla-get-Name lay)) (strcase keep)) (setq target lay))
      (t (setq doomed (cons lay doomed)))
    )
  )
  (if target
    (progn
      (vla-put-ActiveLayout doc target) ; the current sheet can't be deleted
      (foreach lay doomed (vla-Delete lay))
      (repeat 3 (vla-PurgeAll doc))     ; repeat: purging can free nested items
      t
    )
  )
)

;; Open the copy at PATH, keep only sheet NAME, save and close it.
(defun dd:make-sheet (docs path name / d ok)
  (setq d (vla-Open docs path :vlax-false))
  (setq ok (vl-catch-all-apply 'dd:keep-only (list d name)))
  (if (and ok (not (vl-catch-all-error-p ok)))
    (progn (vla-Save d) (vla-Close d :vlax-false) t)
    (progn (vla-Close d :vlax-false) nil)
  )
)

(defun c:SPLITSHEETS (/ acad docs doc src base dir sheets done failed path res ans)
  (setq acad (vlax-get-acad-object)
        docs (vla-get-Documents acad)
        doc  (vla-get-ActiveDocument acad)
  )
  (cond
    ((= (getvar "SDI") 1)
     (alert "SPLITSHEETS needs AutoCAD to allow several open drawings.\n\nType SDI, enter 0, then run SPLITSHEETS again.")
    )
    ((= (getvar "DWGTITLED") 0)
     (alert "Save this drawing first, then run SPLITSHEETS again.")
    )
    ((not (setq sheets (dd:sheets doc)))
     (alert "This drawing has no sheets (layout tabs) to split.")
    )
    (t
     ;; the copies are made from the file on disk, so offer to save first
     (if (/= (getvar "DBMOD") 0)
       (progn
         (initget "Yes No")
         (setq ans (getkword "\nSave your latest changes first so the copies include them? [Yes/No] <Yes>: "))
         (if (/= ans "No") (vla-Save doc))
       )
     )
     (setq src  (strcat (getvar "DWGPREFIX") (getvar "DWGNAME"))
           base (vl-filename-base (getvar "DWGNAME"))
           dir  (strcat (getvar "DWGPREFIX") base " - sheets\\")
     )
     (vl-mkdir dir)
     (foreach name sheets
       (setq path (strcat dir base " - " (dd:safe-name name) ".dwg"))
       (princ (strcat "\nSaving sheet \"" name "\" ..."))
       (if (findfile path) (vl-file-delete path))
       (if (vl-file-copy src path)
         (progn
           (setq res (vl-catch-all-apply 'dd:make-sheet (list docs path name)))
           (if (or (vl-catch-all-error-p res) (not res))
             (progn (setq failed (cons name failed)) (vl-file-delete path))
             (setq done (cons name done))
           )
         )
         (setq failed (cons name failed))
       )
     )
     (vla-Activate doc)
     (alert
       (strcat
         (itoa (length done)) " of " (itoa (length sheets)) " sheets saved to:\n\n" dir
         (if failed
           (strcat "\n\nCould not save: "
                   (apply 'strcat (mapcar '(lambda (s) (strcat "\n  - " s)) (reverse failed))))
           ""
         )
       )
     )
    )
  )
  (princ)
)

(princ "\nSplitSheets loaded. Type SPLITSHEETS to save every sheet as its own DWG.")
(princ)
