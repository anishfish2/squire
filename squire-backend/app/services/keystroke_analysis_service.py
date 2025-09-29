import asyncio
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
import traceback

from app.core.database import supabase


class KeystrokeAnalysisService:
    def __init__(self):
        self.analysis_cache = {}
        print("🎹 KeystrokeAnalysisService initialized")

    def _convert_timestamp(self, timestamp_value):
        """Convert various timestamp formats to proper datetime"""
        if not timestamp_value:
            return datetime.now(timezone.utc).isoformat()

        # If it's already a datetime string, return it
        if isinstance(timestamp_value, str):
            try:
                # Try parsing as ISO format
                datetime.fromisoformat(timestamp_value.replace('Z', '+00:00'))
                return timestamp_value
            except:
                pass

        # If it's a numeric timestamp (milliseconds since epoch)
        if isinstance(timestamp_value, (int, float, str)):
            try:
                # Convert to float and handle milliseconds
                timestamp_float = float(timestamp_value)

                # If the number is very large, it's likely milliseconds
                if timestamp_float > 1e12:  # Likely milliseconds
                    timestamp_float = timestamp_float / 1000

                # Convert to datetime
                dt = datetime.fromtimestamp(timestamp_float, tz=timezone.utc)
                return dt.isoformat()
            except (ValueError, OSError):
                pass

        # Fallback to current time
        return datetime.now(timezone.utc).isoformat()

    async def process_keystroke_sequence(
        self,
        user_id: str,
        sequence_data: Dict[str, Any],
        session_context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Process and analyze a keystroke sequence"""
        try:
            print(f"🎹 Processing keystroke sequence: {sequence_data.get('keystroke_count', 0)} keystrokes")

            # Store the raw sequence data
            stored_sequence = await self._store_keystroke_sequence(user_id, sequence_data, session_context)

            # Analyze patterns in the sequence
            pattern_analysis = await self._analyze_keystroke_patterns(sequence_data)

            # Detect efficiency opportunities
            efficiency_analysis = await self._analyze_efficiency_opportunities(sequence_data, session_context)

            # Store analysis results
            analysis_results = {
                "sequence_id": stored_sequence.get("id"),
                "patterns_detected": len(pattern_analysis.get("significant_patterns", [])),
                "efficiency_score": efficiency_analysis.get("efficiency_score", 0.5),
                "pattern_analysis": pattern_analysis,
                "efficiency_analysis": efficiency_analysis,
                "recommendations": efficiency_analysis.get("recommendations", [])
            }

            await self._store_analysis_results(user_id, stored_sequence.get("id"), analysis_results)

            print(f"✅ Keystroke analysis complete: {analysis_results['patterns_detected']} patterns detected")
            return analysis_results

        except Exception as e:
            print(f"❌ Error processing keystroke sequence: {e}")
            traceback.print_exc()
            return {
                "sequence_id": None,
                "patterns_detected": 0,
                "efficiency_score": 0.0,
                "error": str(e)
            }

    async def _store_keystroke_sequence(
        self,
        user_id: str,
        sequence_data: Dict[str, Any],
        session_context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Store keystroke sequence in database"""
        try:
            # Create database record
            sequence_record = {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "sequence_start": self._convert_timestamp(sequence_data.get("sequence_start")),
                "sequence_duration": sequence_data.get("sequence_duration"),
                "keystroke_count": sequence_data.get("keystroke_count"),
                "sequence_data": {
                    "keys": sequence_data.get("keys", []),
                    "timings": sequence_data.get("timings", []),
                    "modifiers": sequence_data.get("modifiers", []),
                    "states": sequence_data.get("states", []),
                    "down_keys": sequence_data.get("down_keys", []),
                    "patterns": sequence_data.get("patterns", {}),
                    "metadata": sequence_data.get("metadata", {}),
                    "context_data": sequence_data.get("context_data", {})
                },
                "app_context": sequence_data.get("context_data", {}).get("primary_app", "Unknown"),
                "session_context": session_context,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat()
            }

            # Store in database
            result = supabase.table("keystroke_sequences").insert(sequence_record).execute()

            print(f"💾 Stored keystroke sequence: {sequence_record['id']}")
            return result.data[0] if result.data else sequence_record

        except Exception as e:
            print(f"❌ Error storing keystroke sequence: {e}")
            raise

    async def _analyze_keystroke_patterns(self, sequence_data: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze patterns in keystroke sequence"""
        try:
            keys = sequence_data.get("keys", [])
            timings = sequence_data.get("timings", [])
            modifiers = sequence_data.get("modifiers", [])
            patterns = sequence_data.get("patterns", {})

            analysis = {
                "repetitive_patterns": self._analyze_repetitive_patterns(patterns.get("repetitive_sequences", [])),
                "timing_analysis": self._analyze_timing_patterns(patterns.get("timing_patterns", {})),
                "navigation_analysis": self._analyze_navigation_patterns(patterns.get("navigation_sequences", [])),
                "shortcut_analysis": self._analyze_shortcut_patterns(patterns.get("shortcut_sequences", [])),
                "efficiency_indicators": self._calculate_efficiency_indicators(sequence_data),
                "significant_patterns": []
            }

            # Identify significant patterns that might indicate inefficiencies
            analysis["significant_patterns"] = self._identify_significant_patterns(analysis)

            return analysis

        except Exception as e:
            print(f"❌ Error analyzing keystroke patterns: {e}")
            return {"error": str(e)}

    def _analyze_repetitive_patterns(self, repetitive_sequences: List[Dict]) -> Dict[str, Any]:
        """Analyze repetitive keystroke patterns"""
        if not repetitive_sequences:
            return {"total_repetitive_sequences": 0}

        # Analyze repetitive patterns for efficiency opportunities
        high_repetition_sequences = [seq for seq in repetitive_sequences if seq.get("repetitions", 0) >= 5]
        navigation_repetitions = [seq for seq in repetitive_sequences
                                if seq.get("key") in ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "j", "k", "h", "l"]]

        return {
            "total_repetitive_sequences": len(repetitive_sequences),
            "high_repetition_sequences": len(high_repetition_sequences),
            "navigation_repetitions": len(navigation_repetitions),
            "repetition_details": repetitive_sequences[:5],  # Store first 5 for analysis
            "potential_inefficiencies": len(high_repetition_sequences) > 0
        }

    def _analyze_timing_patterns(self, timing_patterns: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze timing patterns for efficiency insights"""
        if not timing_patterns:
            return {"typing_efficiency": "unknown"}

        avg_interval = timing_patterns.get("avg_interval", 200)
        rhythm = timing_patterns.get("typing_rhythm", "unknown")
        variance = timing_patterns.get("interval_variance", 0)

        # Determine efficiency indicators
        efficiency_score = 0.5  # Default neutral
        if rhythm == "fast_consistent":
            efficiency_score = 0.8
        elif rhythm == "slow_deliberate" and variance < 100:
            efficiency_score = 0.6  # Careful but consistent
        elif avg_interval > 500:
            efficiency_score = 0.3  # Very slow typing

        return {
            "avg_interval": avg_interval,
            "typing_rhythm": rhythm,
            "variance": variance,
            "efficiency_score": efficiency_score,
            "typing_speed_category": self._categorize_typing_speed(avg_interval),
            "consistency_rating": "high" if variance < 50 else "medium" if variance < 150 else "low"
        }

    def _analyze_navigation_patterns(self, navigation_sequences: List[Dict]) -> Dict[str, Any]:
        """Analyze navigation patterns for efficiency opportunities"""
        if not navigation_sequences:
            return {"navigation_efficiency": "no_data"}

        total_sequences = len(navigation_sequences)
        long_sequences = [seq for seq in navigation_sequences if len(seq.get("keys", [])) >= 5]

        # Check for potentially inefficient navigation patterns
        repetitive_navigation = [seq for seq in navigation_sequences
                               if seq.get("pattern_type") in ["vertical_down", "vertical_up"]
                               and len(seq.get("keys", [])) >= 5]

        return {
            "total_navigation_sequences": total_sequences,
            "long_navigation_sequences": len(long_sequences),
            "repetitive_navigation_sequences": len(repetitive_navigation),
            "potential_vim_opportunities": len(repetitive_navigation) > 0,
            "navigation_efficiency_score": max(0, 1.0 - (len(long_sequences) / max(total_sequences, 1)))
        }

    def _analyze_shortcut_patterns(self, shortcut_sequences: List[Dict]) -> Dict[str, Any]:
        """Analyze keyboard shortcut usage patterns"""
        if not shortcut_sequences:
            return {"shortcut_usage": "minimal"}

        shortcuts = [seq.get("shortcut", "") for seq in shortcut_sequences]
        unique_shortcuts = set(shortcuts)

        # Common efficiency shortcuts
        productivity_shortcuts = [
            "cmd+c", "cmd+v", "cmd+x", "cmd+z", "cmd+s", "cmd+f", "cmd+a",
            "ctrl+c", "ctrl+v", "ctrl+x", "ctrl+z", "ctrl+s", "ctrl+f", "ctrl+a"
        ]

        used_productivity_shortcuts = [s for s in shortcuts if s.lower() in productivity_shortcuts]

        return {
            "total_shortcuts": len(shortcuts),
            "unique_shortcuts": len(unique_shortcuts),
            "productivity_shortcuts_used": len(used_productivity_shortcuts),
            "shortcut_diversity": len(unique_shortcuts) / max(len(shortcuts), 1),
            "most_used_shortcuts": list(unique_shortcuts)[:5]
        }

    def _calculate_efficiency_indicators(self, sequence_data: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate overall efficiency indicators for the sequence"""
        metadata = sequence_data.get("metadata", {})
        patterns = sequence_data.get("patterns", {})

        total_keystrokes = metadata.get("total_keystrokes", 0)
        shortcuts_used = metadata.get("shortcuts_used", 0)
        navigation_keys = metadata.get("navigation_keys_used", 0)

        # Calculate efficiency ratios
        shortcut_ratio = shortcuts_used / max(total_keystrokes, 1)
        navigation_ratio = navigation_keys / max(total_keystrokes, 1)

        # Analyze repetitive patterns for inefficiency detection
        repetitive_sequences = patterns.get("repetitive_sequences", [])
        high_repetition_count = len([seq for seq in repetitive_sequences if seq.get("repetitions", 0) >= 5])

        return {
            "shortcut_usage_ratio": shortcut_ratio,
            "navigation_usage_ratio": navigation_ratio,
            "repetitive_pattern_score": min(high_repetition_count / max(total_keystrokes, 1), 1.0),
            "overall_efficiency_estimate": self._estimate_overall_efficiency(shortcut_ratio, navigation_ratio, high_repetition_count)
        }

    def _estimate_overall_efficiency(self, shortcut_ratio: float, navigation_ratio: float, high_repetition_count: int) -> float:
        """Estimate overall efficiency score for the sequence"""
        efficiency_score = 0.5  # Start neutral

        # Bonus for good shortcut usage
        if shortcut_ratio > 0.1:
            efficiency_score += 0.2
        elif shortcut_ratio > 0.05:
            efficiency_score += 0.1

        # Penalty for excessive repetitive patterns
        if high_repetition_count > 3:
            efficiency_score -= 0.3
        elif high_repetition_count > 1:
            efficiency_score -= 0.1

        # Slight penalty for excessive navigation (might indicate inefficient movement)
        if navigation_ratio > 0.3:
            efficiency_score -= 0.1

        return max(0.0, min(1.0, efficiency_score))

    def _identify_significant_patterns(self, analysis: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Identify patterns that might warrant efficiency suggestions"""
        significant_patterns = []

        # Check repetitive navigation
        repetitive_nav = analysis.get("navigation_analysis", {}).get("repetitive_navigation_sequences", 0)
        if repetitive_nav > 0:
            significant_patterns.append({
                "type": "repetitive_navigation",
                "severity": "medium" if repetitive_nav < 3 else "high",
                "description": f"{repetitive_nav} sequences of repetitive navigation detected",
                "suggestion_category": "navigation_optimization"
            })

        # Check low shortcut usage
        shortcut_ratio = analysis.get("efficiency_indicators", {}).get("shortcut_usage_ratio", 0)
        if shortcut_ratio < 0.05:  # Less than 5% shortcuts
            significant_patterns.append({
                "type": "low_shortcut_usage",
                "severity": "medium",
                "description": "Low keyboard shortcut usage detected",
                "suggestion_category": "shortcut_learning"
            })

        # Check high repetition patterns
        high_repetitions = analysis.get("repetitive_patterns", {}).get("high_repetition_sequences", 0)
        if high_repetitions > 2:
            significant_patterns.append({
                "type": "high_repetition",
                "severity": "high",
                "description": f"{high_repetitions} highly repetitive sequences detected",
                "suggestion_category": "automation_opportunity"
            })

        return significant_patterns

    def _categorize_typing_speed(self, avg_interval: float) -> str:
        """Categorize typing speed based on average interval"""
        if avg_interval < 100:
            return "fast"
        elif avg_interval < 200:
            return "moderate"
        elif avg_interval < 400:
            return "slow"
        else:
            return "very_slow"

    async def _analyze_efficiency_opportunities(
        self,
        sequence_data: Dict[str, Any],
        session_context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Analyze sequence for efficiency improvement opportunities"""
        try:
            app_name = sequence_data.get("context_data", {}).get("primary_app", "Unknown")
            patterns = sequence_data.get("patterns", {})

            # Basic efficiency analysis
            recommendations = []
            efficiency_score = 0.5

            # Check for vim-style navigation opportunities
            navigation_sequences = patterns.get("navigation_sequences", [])
            repetitive_nav = [seq for seq in navigation_sequences
                            if seq.get("pattern_type") in ["vertical_down", "vertical_up"]
                            and len(seq.get("keys", [])) >= 5]

            if repetitive_nav and any("vim" in app_name.lower() or "code" in app_name.lower()
                                   or "terminal" in app_name.lower() for app_name in [app_name]):
                recommendations.append({
                    "type": "navigation_efficiency",
                    "suggestion": "Consider using vim navigation commands like '5j' instead of pressing arrow keys repeatedly",
                    "confidence": 0.8,
                    "context": app_name
                })
                efficiency_score -= 0.2

            # Check shortcut usage
            shortcut_sequences = patterns.get("shortcut_sequences", [])
            if len(shortcut_sequences) < 2 and sequence_data.get("keystroke_count", 0) > 20:
                recommendations.append({
                    "type": "shortcut_opportunity",
                    "suggestion": f"Consider learning keyboard shortcuts for {app_name} to improve efficiency",
                    "confidence": 0.6,
                    "context": app_name
                })

            return {
                "efficiency_score": max(0.0, min(1.0, efficiency_score)),
                "recommendations": recommendations,
                "analysis_context": {
                    "app_name": app_name,
                    "total_keystrokes": sequence_data.get("keystroke_count", 0),
                    "sequence_duration": sequence_data.get("sequence_duration", 0)
                }
            }

        except Exception as e:
            print(f"❌ Error analyzing efficiency opportunities: {e}")
            return {
                "efficiency_score": 0.5,
                "recommendations": [],
                "error": str(e)
            }

    async def _store_analysis_results(
        self,
        user_id: str,
        sequence_id: str,
        analysis_results: Dict[str, Any]
    ) -> None:
        """Store keystroke analysis results"""
        try:
            if not sequence_id:
                print("⚠️ No sequence_id provided, skipping analysis storage")
                return

            # Create analysis record
            analysis_record = {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "sequence_id": sequence_id,
                "analysis_data": analysis_results,
                "created_at": datetime.now(timezone.utc).isoformat()
            }

            # Store in database
            result = supabase.table("keystroke_analysis").insert(analysis_record).execute()
            print(f"💾 Stored keystroke analysis: {analysis_record['id']}")

        except Exception as e:
            print(f"❌ Error storing analysis results: {e}")

    async def get_user_keystroke_patterns(
        self,
        user_id: str,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Get recent keystroke patterns for a user"""
        try:
            result = supabase.table("keystroke_sequences").select("*").eq(
                "user_id", user_id
            ).order("created_at", desc=True).limit(limit).execute()

            return result.data if result.data else []

        except Exception as e:
            print(f"❌ Error getting user keystroke patterns: {e}")
            return []

    async def get_efficiency_insights(
        self,
        user_id: str,
        app_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get efficiency insights for a user, optionally filtered by app"""
        try:
            # Get recent analyses
            query = supabase.table("keystroke_analysis").select("*").eq("user_id", user_id)

            if app_name:
                # This would need more complex filtering in production
                pass

            result = query.order("created_at", desc=True).limit(20).execute()

            if not result.data:
                return {"insights": "No keystroke data available"}

            # Aggregate insights
            analyses = result.data
            total_analyses = len(analyses)
            avg_efficiency = sum(a.get("analysis_data", {}).get("efficiency_score", 0.5) for a in analyses) / total_analyses

            common_recommendations = {}
            for analysis in analyses:
                recommendations = analysis.get("analysis_data", {}).get("recommendations", [])
                for rec in recommendations:
                    rec_type = rec.get("type", "unknown")
                    common_recommendations[rec_type] = common_recommendations.get(rec_type, 0) + 1

            return {
                "total_analyses": total_analyses,
                "average_efficiency_score": avg_efficiency,
                "common_improvement_areas": common_recommendations,
                "recent_insights": [a.get("analysis_data", {}) for a in analyses[:5]]
            }

        except Exception as e:
            print(f"❌ Error getting efficiency insights: {e}")
            return {"error": str(e)}