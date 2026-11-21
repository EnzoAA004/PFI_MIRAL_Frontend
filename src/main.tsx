import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import App from "./App";
import { UnsavedChangesGuard } from "./features/navigation/UnsavedChangesGuard";
import "./design/tokens.css";
import "./design/base.css";
import "./design/components.css";
// Feature stylesheets: each migrated screen owns its CSS instead of adding another
// override layer to components.css.
import "./design/shell.css";
import "./features/worklist/worklist.css";
import "./features/reading/reading.css";
import "./features/prereport/prereport.css";
import "./features/settings/settings.css";
import "./design/utilities.css";
import "./a11yDev";

const router = createBrowserRouter([{ path: "*", element: <><App /><UnsavedChangesGuard /></> }]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
