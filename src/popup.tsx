import { createMemoryRouter, RouterProvider } from "react-router"

import RootLayout from "./popup/layouts/root-layout"
import HomePage from "./popup/routes/index"

import "./style.css"

const router = createMemoryRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <HomePage />
      }
    ]
  }
])

function IndexPopup() {
  return <RouterProvider router={router} />
}

export default IndexPopup
