package driftcheck.model

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ModelTest {
    private val schema = jsonSchemaOf(FeatureSpec.serializer())

    private fun JsonObject.obj(name: String) = getValue(name).jsonObject
    private fun JsonObject.names(name: String) = getValue(name).jsonArray.map { it.jsonPrimitive.content }

    @Test
    fun `the schema has the same fields as the class, closed and with optional fields not required`() {
        assertEquals("object", schema["type"]?.jsonPrimitive?.content)
        assertEquals(JsonPrimitive(false), schema["additionalProperties"])
        assertEquals(setOf("feature", "platform", "summary", "items", "notFound", "coverage"), schema.obj("properties").keys)
        assertEquals(listOf("feature", "platform", "summary", "items"), schema.names("required"))
    }

    @Test
    fun `requires at least one piece of evidence per item in the schema`() {
        val item = schema.obj("properties").obj("items").obj("items")
        assertEquals(JsonPrimitive(1), item.obj("properties").obj("evidence")["minItems"])
        // Lists without the annotation stay unconstrained
        assertEquals(null, schema.obj("properties").obj("notFound")["minItems"])
    }

    @Test
    fun `enums use their serial names and nested classes are inlined`() {
        assertEquals(listOf("android", "ios"), schema.obj("properties").obj("platform").names("enum"))
        val item = schema.obj("properties").obj("items").obj("items")
        assertContains(item.obj("properties").obj("section").names("enum"), "input_handling")
        val evidence = item.obj("properties").obj("evidence").obj("items")
        assertEquals("integer", evidence.obj("properties").obj("line")["type"]?.jsonPrimitive?.content)
        assertEquals(listOf("file", "line"), evidence.names("required"))
    }

    @Test
    fun `nullable fields allow null`() {
        val finding = jsonSchemaOf(CompareOutput.serializer()).obj("properties").obj("findings").obj("items")
        val android = finding.obj("properties").obj("android")
        assertEquals(
            JsonArray(listOf(JsonObject(mapOf("type" to JsonPrimitive("null"))))),
            JsonArray(android.getValue("anyOf").jsonArray.drop(1)),
        )
        // Nullable but without a default: the model must still say null explicitly
        assertContains(finding.names("required"), "android")
        assertTrue("question" !in finding.names("required"))
    }

    @Test
    fun `parses model output and reports rules the schema cannot express`() {
        val spec = modelJson.decodeFromString<FeatureSpec>(
            """
            {"feature":"search","platform":"ios","summary":"Search","extra":"ignored",
             "items":[{"key":"Bad Key","section":"api","description":" ","evidence":[{"file":"","line":0}]},
                      {"key":"api.limit","section":"api","description":"Limit","value":"20","evidence":[]}]}
            """,
        )
        assertEquals(Platform.IOS, spec.platform)
        assertEquals(
            listOf(
                "items[0] (Bad Key): key must be lowercase dot-separated snake_case",
                "items[0] (Bad Key): description is empty",
                "items[0] (Bad Key).evidence[0]: file is empty",
                "items[1] (api.limit): needs at least one piece of evidence",
            ),
            spec.problems(),
        )
    }

    @Test
    fun `reports findings without a title, keys or any side`() {
        val output = CompareOutput(listOf(Finding(FindingCategory.BUG, Severity.LOW, "", emptyList(), null, null)))
        assertEquals(3, output.problems().size)
    }
}
