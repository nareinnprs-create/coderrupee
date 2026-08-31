import path from "path"

process.env.CODERRUPEE_DB = ":memory:"
process.env.CODERRUPEE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.CODERRUPEE_DISABLE_MODELS_FETCH = "true"
