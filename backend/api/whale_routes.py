from fastapi import APIRouter

from backend.services.whale_monitor import WhaleMonitor, fetch_whale_events

router = APIRouter()


@router.get("/whales")
def get_whales() -> dict:
    events = fetch_whale_events()
    monitor = WhaleMonitor()
    sentiment = monitor.compute_sentiment(events)
    return {
        "events": [
            {"event_type": event.event_type, "amount_btc": event.amount_btc}
            for event in events
        ],
        "sentiment": sentiment,
    }
