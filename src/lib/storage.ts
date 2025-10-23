import { Storage } from "@plasmohq/storage"

// Shared storage instance for consistent storage area across extension
// Using "local" area for better performance and larger quota
export const storage = new Storage({ area: "local" })
