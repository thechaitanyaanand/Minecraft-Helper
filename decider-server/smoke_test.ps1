$ErrorActionPreference = "Stop"
Invoke-RestMethod http://127.0.0.1:8000/health | ConvertTo-Json -Depth 5
$body = @{
  state = @{ player_message = "i need wood"; time = "day"; health = 20; food = 20 }
  questions = @{
    intent = @{
      type = "choice"
      instructions = "What does the player want the helper to do?"
      criteria = @{
        get_wood = "collect wood / logs / trees"
        get_food = "find or make food because hungry"
        unclear  = "the message is not a clear request"
      }
    }
    danger = @{
      type = "noul"
      instructions = "Is the player in immediate danger?"
      criteria = @{ "true" = "a hostile mob is close or health is low"; "false" = "safe" }
    }
  }
} | ConvertTo-Json -Depth 10
$sw = [Diagnostics.Stopwatch]::StartNew()
$r = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/v1/systemone -ContentType "application/json" -Body $body
$sw.Stop()
$r | ConvertTo-Json -Depth 10
"latency_ms: $($sw.ElapsedMilliseconds)"
