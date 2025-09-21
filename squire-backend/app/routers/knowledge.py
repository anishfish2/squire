"""
Knowledge Graph routes
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional, List
from uuid import UUID

from app.core.database import get_supabase, execute_rpc, execute_query, DatabaseError
from app.models.schemas import (
    KnowledgeNode,
    KnowledgeNodeCreate,
    KnowledgeNodeUpdate,
    KnowledgeRelationship,
    KnowledgeRelationshipCreate,
    NodeType,
    RelationshipType,
    SuccessResponse
)

router = APIRouter()


@router.post("/nodes", response_model=dict)
async def create_knowledge_node(
    node_data: KnowledgeNodeCreate,
    supabase=Depends(get_supabase)
):
    """Create/update knowledge node"""
    try:
        node_id = await execute_rpc(
            "upsert_knowledge_node",
            {
                "p_user_id": str(node_data.user_id),
                "p_node_type": node_data.node_type.value,
                "p_content": node_data.content,
                "p_weight": node_data.weight,
                "p_source_event_ids": [str(eid) for eid in node_data.source_event_ids],
                "p_metadata": node_data.metadata
            }
        )

        node = await execute_query(
            table="knowledge_nodes",
            operation="select",
            filters={"id": str(node_id)},
            single=True
        )

        return {
            "node": KnowledgeNode(**node),
            "node_id": node_id
        }
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/nodes/user/{user_id}", response_model=dict)
async def get_user_knowledge_nodes(
    user_id: UUID,
    node_type: Optional[NodeType] = Query(None),
    min_weight: Optional[float] = Query(None, ge=0.0),
    limit: int = Query(100, le=1000),
    offset: int = Query(0, ge=0),
    order_by: str = Query("weight"),
    order_direction: str = Query("desc"),
    supabase=Depends(get_supabase)
):
    """Get all knowledge nodes for user"""
    try:
        filters = {"user_id": str(user_id)}

        if node_type:
            filters["node_type"] = node_type.value

        nodes = await execute_query(
            table="knowledge_nodes",
            operation="select",
            filters=filters,
            order_by=order_by,
            ascending=(order_direction == "asc"),
            limit=limit,
            offset=offset
        )

        if nodes and min_weight is not None:
            nodes = [n for n in nodes if n.get("weight", 0) >= min_weight]

        return {"nodes": [KnowledgeNode(**node) for node in (nodes or [])]}
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/relationships", response_model=dict)
async def create_knowledge_relationship(
    relationship_data: KnowledgeRelationshipCreate,
    supabase=Depends(get_supabase)
):
    """Create/update knowledge relationship"""
    try:
        relationship_id = await execute_rpc(
            "upsert_knowledge_relationship",
            {
                "p_user_id": str(relationship_data.user_id),
                "p_source_node_id": str(relationship_data.source_node_id),
                "p_target_node_id": str(relationship_data.target_node_id),
                "p_relationship_type": relationship_data.relationship_type.value,
                "p_strength": relationship_data.strength,
                "p_metadata": relationship_data.metadata
            }
        )

        relationship = await execute_query(
            table="knowledge_relationships",
            operation="select",
            filters={"id": str(relationship_id)},
            single=True
        )

        return {
            "relationship": KnowledgeRelationship(**relationship),
            "relationship_id": relationship_id
        }
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/traverse/{user_id}/{node_id}", response_model=dict)
async def traverse_knowledge_graph(
    user_id: UUID,
    node_id: UUID,
    relationship_types: Optional[str] = Query(None),
    max_depth: int = Query(3, ge=1, le=10),
    min_strength: float = Query(0.3, ge=0.0, le=1.0),
    supabase=Depends(get_supabase)
):
    """Traverse knowledge graph"""
    try:
        relationship_types_list = None
        if relationship_types:
            relationship_types_list = relationship_types.split(",")

        graph = await execute_rpc(
            "traverse_knowledge_graph",
            {
                "p_user_id": str(user_id),
                "p_start_node_id": str(node_id),
                "p_relationship_types": relationship_types_list,
                "p_max_depth": max_depth,
                "p_min_strength": min_strength
            }
        )

        return {"graph": graph or []}
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/path/{user_id}/{source_id}/{target_id}", response_model=dict)
async def find_connection_path(
    user_id: UUID,
    source_id: UUID,
    target_id: UUID,
    max_depth: int = Query(5, ge=1, le=10),
    supabase=Depends(get_supabase)
):
    """Find connection path between nodes"""
    try:
        path = await execute_rpc(
            "find_connection_path",
            {
                "p_user_id": str(user_id),
                "p_start_node_id": str(source_id),
                "p_end_node_id": str(target_id),
                "p_max_depth": max_depth
            }
        )

        return {"path": path}
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/similar/{user_id}", response_model=dict)
async def find_similar_nodes(
    user_id: UUID,
    node_type: Optional[NodeType] = Query(None),
    content_search: Optional[str] = Query(None),
    limit: int = Query(10, le=100),
    supabase=Depends(get_supabase)
):
    """Find similar nodes"""
    try:
        similar_nodes = await execute_rpc(
            "find_similar_nodes",
            {
                "p_user_id": str(user_id),
                "p_node_type": node_type.value if node_type else None,
                "p_content_search": content_search,
                "p_limit": limit
            }
        )

        return {"similar_nodes": similar_nodes or []}
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/analytics/{user_id}", response_model=dict)
async def get_knowledge_analytics(
    user_id: UUID,
    supabase=Depends(get_supabase)
):
    """Get knowledge graph analytics"""
    try:
        nodes = await execute_query(
            table="knowledge_nodes",
            operation="select",
            filters={"user_id": str(user_id)}
        )

        relationships = await execute_query(
            table="knowledge_relationships",
            operation="select",
            filters={"user_id": str(user_id)}
        )

        analytics = {
            "nodes": {
                "total": len(nodes or []),
                "by_type": {},
                "avg_weight": 0,
                "top_nodes": []
            },
            "relationships": {
                "total": len(relationships or []),
                "by_type": {},
                "avg_strength": 0,
                "strongest": []
            },
            "connectivity": {
                "density": 0,
                "isolated_nodes": 0
            }
        }

        if nodes:
            # Calculate by type
            for node in nodes:
                node_type = node.get("node_type", "unknown")
                analytics["nodes"]["by_type"][node_type] = analytics["nodes"]["by_type"].get(node_type, 0) + 1

            # Calculate average weight
            weights = [n.get("weight", 0) for n in nodes]
            analytics["nodes"]["avg_weight"] = sum(weights) / len(weights)

            # Top nodes by weight
            sorted_nodes = sorted(nodes, key=lambda x: x.get("weight", 0), reverse=True)[:10]
            analytics["nodes"]["top_nodes"] = [
                {"id": n["id"], "weight": n.get("weight", 0), "type": n.get("node_type")}
                for n in sorted_nodes
            ]

        if relationships:
            # Calculate by type
            for rel in relationships:
                rel_type = rel.get("relationship_type", "unknown")
                analytics["relationships"]["by_type"][rel_type] = analytics["relationships"]["by_type"].get(rel_type, 0) + 1

            # Calculate average strength
            strengths = [r.get("strength", 0) for r in relationships]
            analytics["relationships"]["avg_strength"] = sum(strengths) / len(strengths)

            # Strongest relationships
            sorted_rels = sorted(relationships, key=lambda x: x.get("strength", 0), reverse=True)[:10]
            analytics["relationships"]["strongest"] = [
                {
                    "id": r["id"],
                    "strength": r.get("strength", 0),
                    "type": r.get("relationship_type"),
                    "source": r.get("source_node_id"),
                    "target": r.get("target_node_id")
                }
                for r in sorted_rels
            ]

        # Calculate connectivity
        if nodes and len(nodes) > 1:
            max_connections = len(nodes) * (len(nodes) - 1)
            analytics["connectivity"]["density"] = len(relationships or []) / max_connections

            # Find isolated nodes
            connected_nodes = set()
            for rel in (relationships or []):
                connected_nodes.add(rel.get("source_node_id"))
                connected_nodes.add(rel.get("target_node_id"))

            analytics["connectivity"]["isolated_nodes"] = len(nodes) - len(connected_nodes)

        return {"analytics": analytics}
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))