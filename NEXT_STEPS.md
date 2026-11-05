I want to be able to click somewhere within the translation or select part* of the translation, and automatically get a context-menu-like pop-up, next to the cursor, where the LLM gives me alternatives for the selected part. For example, suppose we are translating from English to Chinese, and the translation is "我从未见过有如此厚颜无耻之人！", there are two ways to request alternative partial translations:
  a. I click between the characters "颜" and "无", and I should get alternatives for "厚颜无耻", because it is a wellknown Chinese idiom, so it's considered one unit (maybe a token). We cannot change only the character "颜" or only the character "无" - that would not make sense.
  b. I can select the characters "未见" and I should get alternatives for "从未见过" together, because "从未" and "见过" are two units and the selection spans across the two units. It wouldn't make sense to get alternative translations only for exactly the "未见" characters.

I wonder if we should also specifically ask the LLM to output in a structured JSON, like this:
```
{
  "default-translation": "very big",
  "alternatives: [
    "gigantic",
    "enormous",
    "colossal"
  ]
}
```
And then ZhangJing app parses the response so it can prominently display the default translation with bigger fonts at the top, with the alternatives in a smaller font in a bottom partition of the output pane.
We may need to instruct the LLM to take care of escaping certain characters so it doesn't break JSON parsing.
