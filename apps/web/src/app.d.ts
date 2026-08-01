declare global {
  namespace App {
    interface Error {
      message: string
    }

    interface Locals {
      /** JWT from the session cookie, or null when signed out. */
      token: string | null
    }
  }
}

export {}
