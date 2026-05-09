curl https://api.anthropic.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: export 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" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-opus-4-7",
    "max_tokens": 1000,
    "messages": [
      {
        "role": "user",
        "content": "What should I search for to find the latest developments in renewable energy?"
      }
    ]
  }'