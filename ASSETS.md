# Asset provenance and licences

ReSpace Studio downloads no 3D models, HDRIs or texture images.

## Original work in this repository
| Asset | Source | Notes |
|---|---|---|
| Procedural furniture models (`frontend/src/three/Furniture.tsx`) | Written for this project | Built from boxes and cylinders inside each item's declared size. They are approximate concept envelopes, not reconstructions of real products. |
| Procedural material textures (`frontend/src/catalog/materials.ts`) | Written for this project | Wood, fabric, weave, stone and paint patterns generated on a canvas at runtime. |
| Furniture thumbnails (`frontend/src/catalog/thumbnails.tsx`) | Written for this project | Line drawings in SVG. |
| Logo mark and favicon | Written for this project | |
| Lighting environment | drei `Environment` with `Lightformer` shapes | Generated at runtime; no HDRI file. |
| Sample floor plans (`backend/app/samples.py`, `frontend/e2e/fixtures/`) | Drawn programmatically by this project | Synthetic, fictional rooms. They contain no client or personal data. |

## Third-party software (installed through npm and pip; not vendored)
| Package | Licence | Obligation |
|---|---|---|
| Inter font (`@fontsource/inter`) | SIL Open Font License 1.1 | Font files are bundled into the build. Keep the licence notice, which ships inside the package. Do not sell the fonts on their own. |
| Fraunces font (`@fontsource/fraunces`) | SIL Open Font License 1.1 | Same as Inter. |
| three.js, React Three Fiber, drei | MIT | Keep the copyright notices when redistributing. |
| React, React Router, Zustand | MIT | Keep the copyright notices. |
| lucide-react icons | ISC | Keep the copyright notice. |
| pdf.js (`pdfjs-dist`) | Apache-2.0 | Keep the licence and NOTICE files when redistributing. |
| FastAPI, Pydantic, SQLAlchemy, Alembic, argon2-cffi | MIT | Keep the copyright notices. |
| Shapely, Uvicorn | BSD-3-Clause | Keep the copyright notices. |
| Pillow | MIT-CMU (HPND) | Keep the copyright notice. |
| google-genai | Apache-2.0 | Keep the licence notice. |
| pwdlib | MIT (per its project page) | Keep the copyright notice. |

Every licence travels inside its installed package (`node_modules/*/LICENSE`, and the `*.dist-info` folders under `site-packages`). A production bundle built from this repository includes the font files and minified library code. If you publish such a bundle, include these notices with it.

## AI-generated content
The application asks Google Gemini for structured layout data only (positions, sizes, materials and text rationale). It does not request or display AI-generated images, and the 3D view always renders the editable scene data.
