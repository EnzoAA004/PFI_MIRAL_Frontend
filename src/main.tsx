import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import App from "./App";
import "./design/tokens.css";
import "./design/base.css";
import "./design/components.css";
// Feature stylesheets: each migrated screen owns its CSS instead of adding another
// override layer to components.css.
import "./design/shell.css";
import "./features/worklist/worklist.css";
import "./features/reading/reading.css";
import "./features/settings/settings.css";
import "./design/utilities.css";
import "./a11yDev";

// Router de datos: permite bloquear la navegación (incluido el «atrás» del navegador) cuando hay ediciones sin guardar.
// La app sigue resolviendo sus rutas por URL dentro de <App />, igual que antes.
const router = createBrowserRouter([{ path: "*", element: <App /> }]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
