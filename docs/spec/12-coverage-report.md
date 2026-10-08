# 12 — Coverage report (completeness pass)

This is the completeness audit of specs `01`–`10` against the prototype `design/Keystone PM v8.dc.html` (template lines 17–3093, mock data lines 3095–3762, logic lines 3763–5242) and `design/_extracted/template-annotated.html`. It was done by reading source only (no browser, no screenshots).

**Result in one paragraph.** All 59 screen and sub-screen flags (`isXxx`), all 14 top-level overlay flags, all 20 nested drawer and popover flags and all 222 top-level declarations in the data block are now documented. Before this pass, one data constant (`P3NAME`) was missing, and 49 `<sc-if>` flags (empty states, drawer toggles, sub-view switches) were described in prose but their identifiers were never named. Both gaps are closed by "Addendum (completeness pass)" sections. I spot-checked 4 screens from 4 modules in depth (6–7 facts each), plus 5 more screens and the design tokens. That found **one factual error**, now fixed: the 03 §6.3 ranking filter. All other checked facts matched the source.

## 0. Method

| Step | How |
|---|---|
| (a) Flags | Pulled every `<sc-if value="{{ x }}">` from the annotated template: 420 distinct expressions, of which 210 are bare identifiers rather than loop-variable properties. Each identifier was searched for with a word-boundary grep in `01`…`10`. When an identifier was not found, its rendered text or behaviour was searched for in prose. |
| (b) Constants | Took every line-initial `const/let/function` in lines 3095–3762, plus `FR_DAYS`, which is declared mid-line at 3753: 222 declarations, data constants and helpers together. Each was searched for with a word-boundary grep. |
| (c) Spot-checks | Read the spec section, then re-derived each claim from the template line and the `renderValsEN` logic. Seed values were recomputed by hand from the mock data. |
| (d) Fixes | Appended "Addendum (completeness pass)" to 01, 03, 04, 05, 06, 07, 08 and 09. Corrected 03 §6.3 inline. |

`00-overview.md` appeared in the folder during this pass (13:28). It was **not** audited and is excluded from the coverage columns below.

## 1. (a) Screen, overlay and drawer flags

### 1.1 Screen and sub-screen flags (`isXxx`) — 59 of 59 documented

Column "Specs" lists every spec file (01–10) that names the flag. 01 holds the master route table; the module file holds the screen spec.

| Flag | Template line(s) | Definition | Specs | Status |
|---|---|---|---|---|
| `isHome` | 163 | `screen==='home'` | 01, 03 | ✓ |
| `isMyProjects` | 196 | `screen==='myprojects'` | 01, 03 | ✓ |
| `isWorldMap` | 215 | `screen==='worldmap'` | 01, 02, 03 | ✓ |
| `isOverview` | 237 | `screen==='overview'` | 01, 03 | ✓ |
| `isBudget` | 286 | `screen==='budget'` | 01, 04 | ✓ |
| `isSchedule` | 485 | `screen==='schedule'` | 01, 05 | ✓ |
| `isResources` | 573 | `screen==='resources' \|\| screen==='presources'` | 01, 06 | ✓ |
| `isPResources` | 575 | `screen==='presources'` | 01, 06 | ✓ |
| `isProjects` | 638 | `screen==='projects'` | 01, 03 | ✓ |
| `isMeetings` | 753 | `screen==='meetings'` | 01, 05 | ✓ |
| `isContract` | 814 | `screen==='contract'` | 01, 04 | ✓ |
| `isBilling` | 841 | `screen==='billing'` | 01, 04 | ✓ |
| `isStakeholders` | 870 | `screen==='stakeholders'` | 01, 05 | ✓ |
| `isItp` | 880 | `screen==='itp'` | 01, 07 | ✓ |
| `isInterfaces` | 893 | `screen==='interfaces'` | 01, 07 | ✓ |
| `isContingency` | 900 | `screen==='contingency'` | 01, 04 | ✓ |
| `isCommissioning` | 910 | `screen==='commissioning'` | 01, 07 | ✓ |
| `isRex` | 921 | `screen==='rex'` | 01, 07 | ✓ |
| `isHours` | 932 | `screen==='hours'` | 01, 06 | ✓ |
| `isFleet` | 948 | `screen==='fleet'` | 01, 07 | ✓ |
| `isSav` | 956 | `screen==='sav'` | 01, 07 | ✓ |
| `isPfPlan` | 972 | `screen==='pfplan'` | 01, 05 | ✓ |
| `isPlan` | 1024 | `screen==='plan'` | 01, 05 | ✓ |
| `isBom` | 1167 | `screen==='bom'` | 01, 09 | ✓ |
| `isEco` | 1312 | `screen==='eco'` | 01, 09 | ✓ |
| `isDrawings` | 1377 | `screen==='drawings'` | 01, 09 | ✓ |
| `isRates` | 1420 | `screen==='rates'` | 01, 06 | ✓ |
| `isSkills` | 1451 | `screen==='skills'` | 01, 06 | ✓ |
| `isLeave` | 1477 | `screen==='leave'` | 01, 06 | ✓ |
| `isWhatif` | 1504 | `screen==='whatif'` | 01, 05 | ✓ |
| `isMtypes` | 1529 | `screen==='mtypes'` | 01, 09 | ✓ |
| `isSettings` | 1573 | `screen==='settings'` | 01, 10 | ✓ |
| `isDeliveries` | 1598 | `screen==='deliveries'` | 01, 08 | ✓ |
| `isStock` | 1658 | `screen==='stock'` | 01, 08 | ✓ |
| `isMyApprovals` | 1715 | `screen==='myapprovals'` | 01, 08 | ✓ |
| `isTrends` | 1737 | `screen==='trends'` | 01, 04 | ✓ |
| `isRisks` | 1771 | `screen==='risks'` | 01, 07 | ✓ |
| `isChanges` | 1833 | `screen==='changes'` | 01, 07 | ✓ |
| `isQuality` | 1883 | `screen==='quality'` | 01, 07 | ✓ |
| `isProcurement` | 1972 | `screen==='procurement'` | 01, 08 | ✓ |
| `isPortfolio` | 2079 | `screen==='portfolio'` | 01, 03 | ✓ |
| `isCash` | 2143 | `screen==='cash'` | 01, 03 | ✓ |
| `isClient` | 2180 | `screen==='client'` | 01, 03 | ✓ |
| `isPlumbing` | 2237 | `screen==='plumbing'` | 01, 10 | ✓ |
| `isSite` | 2268 | `screen==='site'` | 01, 10 | ✓ |
| `isSiteProj` | 2270 | `project==='HLT-026' (4741)` | 10 | ✓ |
| `isDocs` | 2310 | `screen==='docs'` | 01, 10 | ✓ |
| `isDocTypes` | 2375 | `screen==='doctypes'` | 01, 10 | ✓ |
| `isEng` | 2384 | `screen==='eng'` | 01, 09 | ✓ |
| `isEngProj` | 2386, 2420 | `project==='HLT-026' (4796)` | 09 | ✓ |
| `isEngDisc` | 2418 | `!!engDisc` | 01, 09 | ✓ |
| `isPid` | 2472 | `screen==='pid'` | 01, 09 | ✓ |
| `isPidProj` | 2474 | `project==='HLT-026' (4764)` | 09 | ✓ |
| `isPlm` | 2535 | `screen==='plm'` | 01, 09 | ✓ |
| `isOrders` | 2615 | `screen==='orders'` | 01, 08 | ✓ |
| `isRequests` | 2689 | `screen==='requests'` | 01, 08 | ✓ |
| `isApprovals` | 2731 | `screen==='approvals'` | 01, 08 | ✓ |
| `isMyWork` | 2813 | `screen==='mywork'` | 01, 10 | ✓ |
| `isTask` | 2902 | `screen==='task'` | 01, 10 | ✓ |

### 1.2 Top-level overlays and banners (direct children of `<main>` or of the root) — 14 of 14 documented

| Flag | Template line | What | Specs | Status |
|---|---|---|---|---|
| `navSearching` | 30 | Sidebar quick-jump results mode | 01 | ✓ |
| `navBrowsing` | 38 | Sidebar normal nav tree mode | 01 | ✓ |
| `roleMenuOpen` | 59 | "View as" role menu popover | 01 | ✓ |
| `outside` | 126 | "Outside my workspace" banner | 01, 02, 03, 04, 05, 06, 07, 08, 09, 10 | ✓ |
| `zoneBar` | 130 | Portfolio zone filter bar | 01, 03, 05, 07 | ✓ |
| `afOpenDlg` | 138 | Generic action-form dialog (AF) | 01, 02, 09 | ✓ |
| `hasToast` | 159 | Toast | 01 | ✓ |
| `showDoc` | 2346 | Codex document record drawer | 01, 10 | ✓ |
| `depOpen` | 2363 | "Deposit in Codex" dialog | 01, 10 | ✓ |
| `engImpOpen` | 2452 | Engineering list import dialog | 01, 09 | ✓ |
| `showPartDetail` | 2582 | Part record drawer (BOM / PLM) | 01, 09 | ✓ |
| `npOpen` | 2972 | New project wizard | 01, 02 | ✓ |
| `showForce` | 3058 | Force stage change dialog | 01, 02 | ✓ |
| `nrOpen` | 3071 | New resource request dialog | 01, 02 | ✓ |

### 1.3 Nested drawers and popovers — 20 of 20 documented

The eight drawers marked "identifier added by this pass" were already fully described in prose: content, line range and logic. Only the flag and close-handler names were missing, and the addenda now give them.

| Flag | Template line(s) | What | Specs | Status |
|---|---|---|---|---|
| `searchOpen` | 100 | Header global search popover | 01 | ✓ |
| `notifOpen` | 110 | Notifications popover | 01 | ✓ |
| `projMenuOpen` | 83 | Project switcher popover | 01 | ✓ |
| `selOpen` | 1105 | Plan activity drawer | 01, 05, 07, 08 | ✓ |
| `showProjectPicker` | 79, 97 | Breadcrumb project picker visible | 01, 03, 04, 05, 06, 07, 08, 09, 10 | ✓ |
| `showBaseline` | 521, 531 | Gantt baseline bars (prop) | 01, 02, 05 | ✓ |
| `showSuggestions` | 623 | Resources levelling suggestions | 06 | ✓ |
| `hasNode` | 1233 | BOM tree node drawer | 09 | ✓ |
| `showRisk` | 1815 | Risk drawer | 07 | ✓ |
| `showCR` | 1866 | Change request drawer | 07 | ✓ |
| `showNcr` | 1912 | NCR drawer | 07 | ✓ (identifier added by this pass) |
| `showDlv` | 1955 | Deliverable drawer | 07 | ✓ (identifier added by this pass) |
| `showEco` | 1346 | ECO drawer | 09 | ✓ |
| `showDwg` | 1405 | Drawing drawer | 09 | ✓ |
| `showPidTag` | 2518 | P&ID tag drawer | 09 | ✓ |
| `showDeliv` | 1632 | Delivery drawer | 08 | ✓ (identifier added by this pass) |
| `showStockSel` | 1694 | Stock-line drawer | 08 | ✓ (identifier added by this pass) |
| `showRfq` | 1999 | RFQ drawer | 08 | ✓ (identifier added by this pass) |
| `showInv` | 2043 | Supplier invoice drawer | 08 | ✓ (identifier added by this pass) |
| `showPO` | 2663 | Purchase order drawer | 08 | ✓ (identifier added by this pass) |

### 1.4 All other `<sc-if>` identifier flags

Of the 210 bare-identifier flags, 161 were already named in the specs. The other **49** were empty states, sub-view switches and drawer toggles described only in prose. I checked each one's rendered EN text against the spec, and every one was already there. They are now indexed by identifier, template line, logic line, EN text and FR text:

| Spec addendum | Flags indexed |
|---|---|
| 01 | `navNoHit`, `noProjOptions`, `noHits` |
| 03 | `noDecisions`, `noDecided`, `noCpInv`, `noCpVault` |
| 04 | `noRec`, `noContract`, `noToInvoice`, `noInvoices` (+ `ctrCanEdit` template lines) |
| 05 | `mtgIsMeetings/Decisions/Actions`, `noMeetings`, `hasMtgSel`, `hasMtgPrep`, `noStk`, `hasRaci` |
| 06 | `ratesVisible` |
| 07 | `noItp`, `noIfc`, `zoneEmptyFleet`, `zoneEmptySav`, `noRisks`, `noCRRows`, `noNcr`, `showNcr`, `noDlv`, `showDlv` |
| 08 | `noDeliv`, `showDeliv`, `noStock`, `showStockSel`, `noApprovals`, `showRfq`, `noInv`, `showInv`, `noPOs`, `showPO`, `queueEmpty`, `decidedEmpty`, `teamEmpty` |
| 09 | `bomHasFilter`, `noSpares`, `noEcos`, `noDwgs`, `engNotProj`, `noPid`, `pidNotProj` |

After the pass, a re-run of the grep finds 0 of the 210 flags unnamed.

## 2. (b) Top-level declarations in lines 3095–3762 — 222 of 222 referenced

Before this pass 221 of 222 were referenced. The one gap was `P3NAME` (3748), now documented in `09` Addendum A.1. The table includes helper functions (`pct`, `dateOf`, `zoneOf`, `genPOs`, `trFR`, …) as well as data constants. `TPL_KEYS` (3751) and `FR_DICT` (3752) were checked only through the extracted JSON files.

| Line | Declaration | Specs naming it |
|---|---|---|
| 3096 | `MO` | 01, 04 |
| 3097 | `HLT_OFFER` | 03, 04 |
| 3098 | `HLT_STREAMS` | 03, 04 |
| 3099 | `offerPoints` | 02, 04 |
| 3100 | `HPV` | 03, 04, 05 |
| 3101 | `REX_FIN` | 03, 04, 07, 09 |
| 3102 | `HEV` | 03, 04, 05 |
| 3103 | `HAC` | 03, 04, 05 |
| 3104 | `HBAC` | 03, 04 |
| 3105 | `PROJECTS` | 01, 03, 05 |
| 3112 | `HCATS` | 04, 06 |
| 3113 | `HTASKS` | 05 |
| 3122 | `HMILES` | 03, 05 |
| 3123 | `PEOPLE` | 01, 05, 06, 07, 08, 10 |
| 3132 | `ROLES` | 03, 06, 08 |
| 3133 | `pct` | 01, 02, 03, 04, 05, 06, 08, 10 |
| 3134 | `dateOf` | 01, 02, 05 |
| 3135 | `LO` | 01, 02, 03, 04, 05, 06, 07, 08, 09, 10 |
| 3136 | `STATUSES` | 01, 02, 03, 05, 10 |
| 3137 | `STAGE_ORDER` | 01, 03 |
| 3138 | `EXEC_STAGES` | 02, 03 |
| 3139 | `PIPE_STAGES` | 02, 03, 05 |
| 3140 | `STAGE_DELIVS` | 01, 03 |
| 3141 | `STAGE_DONE_DEFAULT` | 01, 03 |
| 3142 | `STAGE_HISTORY` | 01, 03, 05 |
| 3143 | `STATUS_MAP_OLD` | 01, 03, 05 |
| 3144 | `pidOf` | 01, 03 |
| 3145 | `pname` | 01, 03, 05, 09 |
| 3146 | `TRANS` | 01, 03, 05 |
| 3147 | `GATES` | 01, 03, 05 |
| 3148 | `LIFE` | 01, 03 |
| 3149 | `EXTRA` | 01, 03, 04, 05, 09 |
| 3161 | `META` | 01, 03 |
| 3162 | `STAGE_OF` | 01, 03 |
| 3163 | `initialProjects` | 01, 03, 05 |
| 3165 | `DAS_LIST` | 03 |
| 3166 | `MACHINE_TYPES` | 03, 09 |
| 3167 | `CLIENT_CODES` | 01, 03 |
| 3168 | `PROJ_ID` | 01, 03, 04, 05, 07, 09 |
| 3169 | `GEO` | 01, 02, 03 |
| 3170 | `ZONES` | 01, 02, 03, 07 |
| 3171 | `COUNTRY_ZONE` | 01, 03, 07 |
| 3172 | `ZONE_BOUNDS` | 01, 02, 03 |
| 3173 | `zoneOf` | 01, 03 |
| 3174 | `CITY_COUNTRY` | 03, 07 |
| 3175 | `zoneOfSite` | 03 |
| 3176 | `clientCode3` | 01, 03 |
| 3177 | `nextProjectId` | 01, 03 |
| 3178 | `nextAnalytic` | 01, 03 |
| 3179 | `NP_TEMPLATES` | 01, 03, 09 |
| 3186 | `NP_TEMPLATES_OLD` | 01, 03 |
| 3192 | `HCAT_ROWS` | 04 |
| 3193 | `HCRS` | 04, 07 |
| 3194 | `HWPS` | 04 |
| 3195 | `OWN` | 05, 08 |
| 3196 | `HACTS` | 05, 06 |
| 3227 | `A1250_RES` | 05, 06 |
| 3228 | `TODOS` | 05, 08, 10 |
| 3257 | `CHECKS` | 05, 10 |
| 3258 | `COMMENTS` | 10 |
| 3259 | `FILES` | 10 |
| 3260 | `ENTRIES` | 06, 10 |
| 3261 | `DESC` | 10 |
| 3262 | `RATES` | 06, 10 |
| 3263 | `PROJ_NAMES` | 09, 10 |
| 3264 | `STATUS_L` | 02, 05, 10 |
| 3265 | `TODAY` | 01, 05, 06, 08, 10 |
| 3266 | `dayDate` | 01, 05, 06, 08, 10 |
| 3267 | `dayLabel` | 01, 06, 08, 10 |
| 3268 | `DEPTS` | 01, 06, 08 |
| 3269 | `DEPT_OF` | 01, 03, 06, 08 |
| 3270 | `REQUESTS` | 01, 05, 06, 08 |
| 3282 | `REQ_STATUS` | 01, 06, 08 |
| 3283 | `NR_ACTS` | 01, 05, 06, 08 |
| 3284 | `DEFS` | 01, 02, 03, 04, 05, 06, 07, 08, 09 |
| 3301 | `INIT_OF` | 01, 05, 08 |
| 3302 | `SRC_OF` | 04, 06, 08 |
| 3303 | `monthDate` | 01, 03, 05, 08 |
| 3304 | `fmtD` | 01, 03, 05, 08 |
| 3305 | `fmtDY` | 01, 05 |
| 3306 | `monthLabels` | 01, 04, 05 |
| 3308 | `HLT_PD` | 01, 04, 05, 07, 09 |
| 3309 | `PD_CACHE` | 04, 05, 09 |
| 3310 | `projectData` | 01, 03, 04, 05, 06, 08, 09 |
| 3340 | `ALL_BYID` | 01, 07, 08, 09, 10 |
| 3341 | `WEAR_SPARE` | 09 |
| 3342 | `PU_LABEL` | 09 |
| 3343 | `PARTS` | 01, 08, 09 |
| 3399 | `SPARE_LISTS` | 09 |
| 3405 | `STATUS_NOTE` | 09 |
| 3406 | `HLT_POS` | 08 |
| 3414 | `PO_FLOW` | 02, 08 |
| 3415 | `genPOs` | 08, 09 |
| 3421 | `TREE` | 09 |
| 3426 | `TREES` | 09 |
| 3427 | `REV_DIFF` | 09 |
| 3428 | `LAST_PRICE` | 08, 09 |
| 3429 | `lastPrice` | 08, 09 |
| 3430 | `ECO_TYPES` | 09 |
| 3431 | `ECO_FLOW` | 02, 08, 09 |
| 3432 | `ECOS` | 09 |
| 3439 | `DRAWINGS` | 01, 09 |
| 3454 | `RATE_ROLES` | 06 |
| 3455 | `MULTS` | 06 |
| 3456 | `SKILLS` | 06, 10 |
| 3457 | `SKILL_LV` | 06 |
| 3458 | `CERTS` | 06 |
| 3459 | `LEAVE` | 06 |
| 3460 | `LEAVE_DAYS` | 06 |
| 3461 | `HOLIDAYS` | 06 |
| 3462 | `LEVERS` | 05, 06 |
| 3463 | `AUTO` | 05, 06 |
| 3464 | `DELIVERABLES` | 03, 05, 07 |
| 3465 | `ROLE_SCREENS` | 01, 02, 03, 04, 05, 06, 07, 08, 09, 10 |
| 3467 | `SETTINGS0` | 01, 04, 06, 07, 08, 10 |
| 3468 | `HLT_DELIV` | 08 |
| 3474 | `DELIV_FLOW` | 02, 08 |
| 3475 | `STOCK0` | 08, 09 |
| 3483 | `STOCK_OPS` | 08 |
| 3484 | `MOVES0` | 08 |
| 3485 | `SNAP_WEEKS` | 02, 04 |
| 3486 | `HLT_SNAPS` | 04 |
| 3487 | `RISKS_HLT` | 01, 04, 07 |
| 3496 | `RESPONSES` | 07 |
| 3497 | `CR_TYPES` | 07 |
| 3498 | `HLT_CRS_X` | 03, 04, 07 |
| 3504 | `BASELINES` | 04, 05, 07 |
| 3505 | `NCR_SEV` | 07 |
| 3506 | `NCR_FLOW` | 02, 07, 08 |
| 3507 | `HLT_NCRS` | 07 |
| 3513 | `DELIV_TYPES` | 07, 08 |
| 3514 | `DELIV_FLOW2` | 02, 03, 07, 08 |
| 3515 | `HLT_DELIVS` | 03, 07, 08 |
| 3526 | `RFQS` | 08 |
| 3531 | `INVOICES` | 08 |
| 3538 | `SUPPLIERS` | 08 |
| 3539 | `SCORE_AXES` | 03, 08 |
| 3540 | `SCORES` | 03, 08 |
| 3541 | `BILLING` | 03, 04 |
| 3542 | `CASH_M` | 03, 04 |
| 3543 | `CLIENT_DOCS` | 03 |
| 3544 | `CLIENT_ISSUES` | 03 |
| 3545 | `NOTIFS` | 01, 02, 07, 10 |
| 3556 | `NOTIF_ICON` | 01 |
| 3557 | `ACTIVITY` | 01, 08, 10 |
| 3570 | `CONNECTORS` | 01, 05, 06, 08, 09, 10 |
| 3571 | `IMPORTS` | 05, 10 |
| 3572 | `AUDIT` | 07, 08, 10 |
| 3573 | `SITE` | 10 |
| 3574 | `SITE_DOCS` | 10 |
| 3575 | `SITE_EQUIP` | 10 |
| 3576 | `SITE_PREREQ` | 10 |
| 3577 | `SITE_ROTATION` | 10 |
| 3578 | `SITE_COLLISIONS` | 06, 10 |
| 3579 | `SITE_COSTS` | 10 |
| 3580 | `SITE_REPORTS` | 10 |
| 3581 | `SITE_PUNCH` | 07, 10 |
| 3582 | `SITE_HSE` | 10 |
| 3583 | `PID` | 01, 02, 03, 09, 10 |
| 3584 | `PLC_LABEL` | 09 |
| 3585 | `PID_TAGS` | 09 |
| 3611 | `PID_STEPS` | 09 |
| 3613 | `prevRev` | 09 |
| 3614 | `DOC_FAM` | 10 |
| 3615 | `DOC_TYPES` | 09, 10 |
| 3616 | `DOC_TYPE` | 10 |
| 3617 | `DOC_WHO` | 10 |
| 3618 | `DOCS` | 09, 10 |
| 3662 | `DOC_SVC` | 10 |
| 3663 | `DOC_VIEWS` | 10 |
| 3664 | `DOC_STATUSES` | 10 |
| 3665 | `PIPE_PLAN` | 05 |
| 3671 | `PG_MONTHS` | 02, 05 |
| 3672 | `mIdx` | 01, 03, 04, 05, 07 |
| 3674 | `AF` | 01, 02, 03, 04, 05, 06, 07, 08, 09, 10 |
| 3701 | `AF_RESULT` | 01, 04, 05, 06, 07, 09, 10 |
| 3703 | `MEETINGS` | 05 |
| 3710 | `MTG_DONE` | 05 |
| 3711 | `MTG_TRANSCRIPTS` | 05 |
| 3712 | `MTG_EXCHANGE` | 05 |
| 3713 | `CONTRACTS` | 03, 04 |
| 3714 | `STAKEHOLDERS` | 05 |
| 3715 | `RACI` | 01, 02, 05, 07, 10 |
| 3716 | `ITP_TEMPLATES` | 01, 07, 09 |
| 3717 | `ITP` | 01, 02, 07, 09, 10 |
| 3718 | `PUNCH` | 07 |
| 3719 | `INTERFACES` | 07 |
| 3720 | `CONTINGENCY` | 04 |
| 3721 | `COMMISSIONING` | 07 |
| 3722 | `AS_MAINT` | 07, 09 |
| 3729 | `FLEET` | 01, 02, 07, 09 |
| 3730 | `CLAIMS` | 07 |
| 3731 | `INTERVENTIONS` | 07 |
| 3732 | `LESSONS` | 07 |
| 3733 | `CLOSURE` | 07, 08 |
| 3734 | `SATISFACTION` | 07 |
| 3735 | `HOURS` | 06 |
| 3736 | `ENG_DISC` | 09 |
| 3737 | `ENG_RCP` | 09, 10 |
| 3738 | `ENG_DOCS` | 09, 10 |
| 3739 | `ENG_INPUTS` | 09 |
| 3740 | `ENG_RULES` | 09 |
| 3741 | `ENG_CHECKS` | 09 |
| 3742 | `ENG_OUTPUTS` | 09 |
| 3743 | `ENG_CHANGES` | 09 |
| 3744 | `ENG_TOOLS` | 09 |
| 3745 | `ENG_MAP` | 09 |
| 3746 | `ENG_DELTAS` | 09 |
| 3747 | `PERSONAS` | 01, 03, 04, 05, 06, 07, 08, 09, 10 |
| 3748 | `P3NAME` | 09 (added by this pass, 09 Addendum A.1) |
| 3751 | `TPL_KEYS` | 01 |
| 3752 | `FR_DICT` | 01, 02, 03, 04, 06, 07, 09, 10 |
| 3753 | `FR_MONTHS` | 01, 02 |
| 3753 | `FR_DAYS` | 01 |
| 3754 | `FR_RULES` | 01, 03, 04, 06, 07, 10 |
| 3755 | `frSeg` | 01, 02, 03, 05, 08 |
| 3756 | `trFR` | 01, 03, 04 |
| 3757 | `SKIP_KEYS` | 01, 02, 03, 04, 06, 07 |
| 3758 | `deepTr` | 01, 02, 03, 04, 05, 06, 07 |
| 3759 | `fixEnt` | 01 |
| 3761 | `wbsParseDate` | 01, 05 |
| 3762 | `wbsFmtDate` | 01, 05 |

## 3. (c) Spot-checks against source

Legend: ✓ = matches source, ✗ = error (fixed).

### 3.1 Risk register — `07` §2.1 (template 1771–1832, logic 4570–4590, data `RISKS_HLT` 3487–3495)

| # | Fact in spec | Source | Result |
|---|---|---|---|
| 1 | Level: Critical ≥ 15 → `tag-accent`; High ≥ 8 → `tag-outline`; Medium ≥ 4 / Low → `tag-neutral` | `rLevel`, `rTag` (4574–4575) | ✓ |
| 2 | Heat-map cell colour by p×i: ≥15 accent-500, ≥8 accent-700, ≥4 accent-900, else neutral-900; text accent-100 when ≥ 8 | `rCell` (4576), `matrix` (4580) | ✓ |
| 3 | KPI "Exposure (EMV)" is LO when EMV > 80 % of contingency; HLT seed €340k = 227 % of €150k | `riskKpis` (4582); 120+60+45+36+40+24+15 = 340 | ✓ |
| 4 | Register sorted by score descending; closed risks included | `riskRows` (4579) | ✓ |
| 5 | Drawer "Open activity" → `{screen:'plan', sel, selOpen:true, risk:null}`; toggle "Close risk" / "Reopen" writes `riskOv[id].status` | `riskVals` (4586–4589) | ✓ |
| 6 | Non-HLT projects: `RISKS_HLT.slice(0,4)` relabelled R-01…R-04, `emv × BAC / 4800`, owner = PM | `risks` (4572) | ✓ |
| 7 | Heat-map seed placement (R-03 at P4/I4; R-07 and R-12 at P2/I5; …; R-05 closed, not plotted) | `RISKS_HLT` | ✓ |

### 3.2 Billing & payments — `04` §4 (template 841–869, logic 4868–4903, data `CONTRACTS` 3713)

| # | Fact in spec | Source | Result |
|---|---|---|---|
| 1 | Invoiced = Σ milestones with status ≠ Planned; seed €3.04M = 55 % of contract | 4879; contract 5400 base + 120 signed amendment = 5520; M1 552 + M2 1104 + M3 1380 = 3036 | ✓ |
| 2 | Payment due = issue date + `ctrTermsDays` (45); overdue against `NOWD` = 30 Sep 2026; M3 due "10 Nov" (prototype shows 9 Nov because of DST) | 4891–4896 | ✓ (the DST remark is correct) |
| 3 | Invoice tags: Paid → neutral, Overdue → accent, Awaiting payment → outline | `ctrInvoices` (4896) | ✓ |
| 4 | Retention = round(collected × 5 %) = €83k (on collected, not invoiced) | `ctrRetention` (4880) | ✓ |
| 5 | "Mark paid" only when `inv.canPay` and `ctrCanEdit`; sets `ctrOv[id]='Paid'`, paid date shows "30 Sep" | template 862; `ctrMsAll` (4875) | ✓ |
| 6 | "Outstanding receivables" coloured accent-300 when > 0; "Next to invoice" LO when late | `billKpis` (4899) | ✓ |

### 3.3 Purchase orders — `08` §2 (template 2615–2688, logic 4305–4337, data `HLT_POS` 3406–3413, `PARTS`)

| # | Fact in spec | Source | Result |
|---|---|---|---|
| 1 | Value = Σ `PARTS.price × qty` / 1000; PO-1052 = €4.99M | 2 × 1,850,000 + 96 × 13,400 = 4,986,400 | ✓ |
| 2 | KPI "Committed" excludes Draft and Cancelled; seed €6.09M | `committed` (4325); 432 + 4986 + 421 + 218 + 19 + 9 | ✓ |
| 3 | `poTag`: Received / Cancelled / Draft → neutral; Partially received → accent; Awaiting approval / Ordered → outline | 4313 | ✓ |
| 4 | Drawer stepper: Draft · Approved · Ordered; glow on "Ordered" while Ordered or Partially received; nothing reached when Cancelled | `poVals.steps` (4334) | ✓ |
| 5 | `createDrafts`: one draft per manufacturer, id `'PO-'+(1100+draftPOs.length+i)`, ordered "25 Sep", `poFilter` reset | 4330; `dayLabel(TODAY=4).slice(4)` = "25 Sep" | ✓ |
| 6 | Late rule: linked activity `pc > 0` and status ∉ {Received, Cancelled} | `needOf`, `poRow` (4314–4315) | ✓ |

### 3.4 Rate cards and Skills matrix — `06` §2–§3 (template 1420–1475, logic 4380–4396, data 3454–3458)

| # | Fact in spec | Source | Result |
|---|---|---|---|
| 1 | Average internal rate = Σ 9 internal roles / (`RATE_ROLES.length` − 1) = "72,33 €/h"; `eur()` always uses `fr-FR` | `eur` 4383, `avgRate` 4388; 651 / 9 | ✓ |
| 2 | Contractor premium = round((118 / 85 − 1) × 100) = "+39%" | `rateKpis` (4389) | ✓ |
| 3 | Masked unless role ∈ {director, pm}; "Weekend multiplier" shown even when masked; multiplier inputs not gated | `canSeeRates` (4382), template 1433 | ✓ |
| 4 | `lvColor`: ≥4 accent-400, 3 accent-600, 2 accent-800, 1 neutral-800, 0 transparent | 4392 | ✓ |
| 5 | Coverage: 8 single-expert skills; Crane & lifting 2 experts / 3 at ≥3; Automation 0 / 1 | `coverage` (4394) over `SKILL_LV` | ✓ |
| 6 | On-call rate for Project manager = 92 × 0.35 = "32,2 €" | `rateRows` (4386) | ✓ |

### 3.5 Additional checks (other modules)

| Spec / screen | Facts checked | Result |
|---|---|---|
| `03` §6 Prioritisation | Scores recomputed from `SCORES` × `SCORE_AXES` (WSA 81, NDC 77, HLT 72, MSR 69, ERP 66, FTU 64, RCF 54); KPIs 6 / €13.63M and 5 / €13.08M; `SCORES` key mismatch for EWA/RBR/CER (already an open question) | ✓ |
| `03` §6.3 | "Rows … whose status is not 'Closed'/'Cancelled'" | **✗**: the filter compares against English names that never occur (statuses are `Clos` / `Annulé`), so it is a no-op. Corrected inline and turned into an OPEN QUESTION. |
| `09` §4.4–4.5, §0.4 | ECO derived status and `locked` rule (4192–4193); `ecoTag`, `partTag`, `dwgTag`, `puTag`, `tsTag`, `statusTag` mappings | ✓ |
| `05` §1.4, §2.4.1 | `scheduleKpis` thresholds (SPI LO < 0.97, float LO < 0); `planKpis` "on the critical path" actually counts `actBehind`; "Next start" sort falls back to WBS order because `mIdx` returns NaN | ✓ |
| `10` §6.4 My work | KPI definitions (4066); `TODAY = 4` → Fri 25 Sep; load = round((40 + 50) / 2) = 45 % for Hélène | ✓ |
| `02` / `04` §0.3–0.4 | Nocturne tokens (`--color-bg/surface/text/accent`, neutral-500/800/900, accent-300, `--radius-md`, `--space-4`, `--shadow-sm`, `.tag-*`); `seg()` helper; `money()`; `LO` / `OK` | ✓ |
| `01` §4.2, §7.2 | ⌘K / Ctrl+K handler (`componentDidMount`); zone bar manager label and abbreviation rule | ✓ |
| `03` §5.2 | Stage slider ARIA and pointer/key handlers (`stDown/stMove/stUp/stKey`) | ✓ |

## 4. Errors found and fixed

| # | File | Error | Fix |
|---|---|---|---|
| E1 | `03-portfolio-home.md` §6.3 | Said ranking rows exclude 'Closed'/'Cancelled'. The code's filter never matches (stage names are French), so nothing is excluded. | Corrected inline, plus an OPEN QUESTION (should `Clos` / `Annulé` / `Garantie` be excluded?). Recorded in 03 Addendum A.1. |

## 5. Gaps filled (addenda)

| File | Added |
|---|---|
| `01` | Index of 3 shell empty-state flags; pointer to this report's flag index. |
| `03` | Erratum E1; index of 4 client-portal empty-state flags (and "Nothing waiting for you" has **no FR_DICT entry**); OPEN QUESTION: the client Documents tab reuses engineering-screen translation keys `T.k731` "Deliverables", `T.k732` "Own documents · …" and `T.k747` "Column mapping", which look mis-assigned. |
| `04` | Index of 4 contract/billing empty-state flags; `ctrCanEdit` also gates the Contract edit buttons (template 832, 833, 835). |
| `05` | Index of 7 Meetings / Stakeholders view and empty-state flags, with the `mtgPrep` derivation (4835). |
| `06` | `ratesVisible` and its pairing with `r.hidden` / `ratesMasked`; constant-coverage note. |
| `07` | Index of 10 flags, including the NCR and deliverable drawer toggles and close handlers; `zoneEmptySav` tests `fleetRows`, not claims (OPEN QUESTION on the wording "No project in this zone"); shared drawer-shell geometry. |
| `08` | Index of 13 flags with the close handlers and state keys of all five drawers; spot-check confirmation. |
| `09` | Missing constant `P3NAME` (3748) with its fallback behaviour at 4252 and 4299; clarification that "Projects equipped" shows the 3-letter usage key ("HLT"), not "HLT-026"; index of 7 flags. |

No addendum was needed in `02` or `10`: everything checked there was already named and correct.

## 6. Residual gaps and limits

1. **Binding identifiers not named literally.** Of the 679 distinct root identifiers bound in the template (excluding loop variables), 110 are still not named in any spec. They are mostly row arrays (`poRows`, `rfqRows`, `stockRows`, `treeRows`), setters (`setPlmQ`, `setStockQ`, `setLogH`), sort/filter helpers (`plmSortIco`, `bomTypeVal`) and close handlers (`closeNotif`, `closeToast`, `closeEngImp`). Their behaviour is described in prose. I sampled about 20 of them and all were covered: the stage slider handlers, `markAll`, `syncCursus` / `openCursus`, `codexSyncNow` / `openCodex`, `clearSel`, `missionCosts`, `hse`, `setCiNew`, `cpIssues`, `satAvg`, `cgBarProg`, `capRows`, `zoneOwnerLabel` / `zoneOwnerName` / `zoneTitle`, `rateRows` / `multRows`. They were not verified one by one.
2. **Depth of spot-checks.** 9 of about 60 screens were re-derived from source. Seeds and geometry for the other screens were not recomputed: Budget EVM curves, Gantt and portfolio-schedule geometry, P&ID validation, Site readiness, Codex filters, Trends.
3. **FR coverage.** Only spot-checked against `fr_dict.json`. One missing entry was confirmed: "Nothing waiting for you". The other FR gaps are listed in each spec's open questions.
4. **`00-overview.md`** was created by another writer during this pass and was not audited.
5. **No runtime or visual check.** By rule, no browser was run and no screenshots were opened. Visual fidelity therefore rests on reading the markup and `styles.css`.
