from fastapi import APIRouter, HTTPException

from models.schemas import PBCCreate, PBCUpdate

router = APIRouter(prefix="/api/pbcs", tags=["PBCs"])


def get_db():
    from main import db_service
    return db_service


@router.get("")
def list_pbcs():
    db = get_db()
    pbcs = db.list_pbcs()
    return {"pbcs": pbcs, "total": len(pbcs)}


@router.get("/{pbc_id}")
def get_pbc(pbc_id: str):
    db = get_db()
    pbc = db.get_pbc(pbc_id)
    if not pbc:
        raise HTTPException(status_code=404, detail=f"PBC {pbc_id} not found")
    return pbc


@router.get("/{pbc_id}/graph")
def get_pbc_graph(pbc_id: str):
    """Get the subgraph centered on this PBC for visualization."""
    db = get_db()
    pbc = db.get_pbc(pbc_id)
    if not pbc:
        raise HTTPException(status_code=404, detail=f"PBC {pbc_id} not found")
    return db.get_pbc_subgraph(pbc_id)


@router.post("", status_code=201)
def create_pbc(data: PBCCreate):
    db = get_db()
    # Auto-generate ID if not provided
    pbc_id = data.id or db.generate_pbc_id()
    pbc_data = {
        "id": pbc_id,
        "name": data.name,
        "description": data.description,
        "api_endpoint": data.api_endpoint or "",
        "status": data.status,
    }
    if db.get_pbc(pbc_id):
        raise HTTPException(status_code=409, detail=f"PBC {pbc_id} already exists")
    pbc = db.create_pbc(pbc_data)
    # Create COMPOSES relationships to ABBs
    for abb_id in data.abb_ids:
        db.add_relationship(pbc_id, abb_id, "COMPOSES")
    pbc["abb_ids"] = data.abb_ids
    return pbc


@router.put("/{pbc_id}")
def update_pbc(pbc_id: str, data: PBCUpdate):
    db = get_db()
    update_data = data.model_dump(exclude_none=True)
    abb_ids = update_data.pop("abb_ids", None)
    if not update_data and abb_ids is None:
        raise HTTPException(status_code=400, detail="No fields to update")
    pbc = None
    if update_data:
        pbc = db.update_pbc(pbc_id, update_data)
        if not pbc:
            raise HTTPException(status_code=404, detail=f"PBC {pbc_id} not found")
    # Update COMPOSES relationships if abb_ids provided
    if abb_ids is not None:
        # Remove existing COMPOSES rels, then recreate
        db._replace_pbc_composes(pbc_id, abb_ids)
    if pbc is None:
        pbc = db.get_pbc(pbc_id)
    return pbc


@router.delete("/{pbc_id}")
def delete_pbc(pbc_id: str):
    db = get_db()
    if not db.delete_pbc(pbc_id):
        raise HTTPException(status_code=404, detail=f"PBC {pbc_id} not found")
    return {"deleted": pbc_id}
