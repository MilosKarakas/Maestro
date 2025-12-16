package maestro.orchestra.yaml

data class YamlActionBack(
    val label: String? = null,
    val optional: Boolean = false,
)

data class YamlActionClearKeychain(
    val label: String? = null,
    val optional: Boolean = false,
)

data class YamlActionHideKeyboard(
    val label: String? = null,
    val optional: Boolean = false,
)

data class YamlActionPasteText(
    val label: String? = null,
    val optional: Boolean = false,
)

data class YamlActionScroll(
    val label: String? = null,
    val optional: Boolean = false,
    val scrollPoint: String? = null, // Format: "x%,y%" e.g. "50%,50%" to scroll at center, or element text to scroll within that element
    val speed: Int = 40, // 0-100, higher = faster/longer scroll. 40 is default
)
