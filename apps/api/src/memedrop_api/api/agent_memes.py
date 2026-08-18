from __future__ import annotations

from fastapi import APIRouter, Request

from memedrop_api.agent_meme_models import GenerateMemeRequest, GenerateMemeResponse
from memedrop_api.identity import InstallHeader, resolve_install_identity
from memedrop_api.services.agent_memes import AgentMemeService

router = APIRouter(prefix="/api/v1/memes", tags=["agent-memes"])


@router.post("/generate", response_model=GenerateMemeResponse)
async def generate_meme(
    body: GenerateMemeRequest,
    request: Request,
    install_id: InstallHeader = None,
) -> GenerateMemeResponse:
    user_id = resolve_install_identity(
        install_id=install_id,
        require_install_id=request.app.state.settings.require_install_id,
    )
    service: AgentMemeService = request.app.state.agent_meme_service
    memes = await service.generate(
        body.input,
        user_id=user_id,
        direction=body.options.direction,
        count=body.options.count,
    )
    return GenerateMemeResponse(status="ok" if memes else "no_fit", memes=memes)
