from fastapi import APIRouter

router = APIRouter()


@router.get("/whales")
def get_whales() -> list[dict]:
    return []
