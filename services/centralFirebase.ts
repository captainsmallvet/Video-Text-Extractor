import { initializeApp, getApps } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

const firebaseConfig = {
  projectId: "gen-lang-client-0014422363",
  appId: "1:978227936883:web:946402bf6886970bc77406",
  apiKey: "AIzaSyAJLNrYkuTt16qs034UlkEBJrMvlrNCnA4",
  authDomain: "gen-lang-client-0014422363.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-29f335c3-c8ac-451f-97d7-9c310736d1d9",
  storageBucket: "gen-lang-client-0014422363.firebasestorage.app",
  messagingSenderId: "978227936883",
  measurementId: ""
};

// Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Initialize Firestore with specific database ID
export const db = getFirestore(app, "ai-studio-29f335c3-c8ac-451f-97d7-9c310736d1d9");

export interface AIModelOption {
  id: string;
  name: string;
  category: string;
  normalizedCategory: 'text' | 'image' | 'video' | 'tts' | 'other';
  order: number;
  isActive: boolean;
  isDefaultL2: boolean;
  isDefaultL1: boolean;
}

export const APP_IMPORTANCE_LEVEL = 2; // Level 2 for this app

export function normalizeCategory(rawCat: string): 'text' | 'image' | 'video' | 'tts' | 'other' {
  const cat = (rawCat || '').toLowerCase().trim();
  if (cat.includes('text') || cat.includes('reasoning') || cat.includes('chat') || cat === 'llm') {
    return 'text';
  }
  if (cat.includes('image') || cat.includes('picture') || cat.includes('draw') || cat.includes('imagen')) {
    return 'image';
  }
  if (cat.includes('video') || cat.includes('clip') || cat.includes('movie')) {
    return 'video';
  }
  if (cat.includes('tts') || cat.includes('audio') || cat.includes('speech') || cat.includes('voice')) {
    return 'tts';
  }
  return 'other';
}

export async function fetchCentralAIModels(): Promise<AIModelOption[]> {
  try {
    const querySnapshot = await getDocs(collection(db, "ai_models"));
    const models: AIModelOption[] = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();

      // Check active status
      const isActive = data.isActive !== undefined ? Boolean(data.isActive) :
                       data.active !== undefined ? Boolean(data.active) :
                       data.is_active !== undefined ? Boolean(data.is_active) : true;

      if (!isActive) return;

      const modelId = data.id || data.modelId || data.value || doc.id;
      const name = data.name || data.displayName || data.label || modelId;
      const rawCategory = (data.category || data.type || data.group || "").toString();
      const normalizedCat = normalizeCategory(rawCategory);

      const order = typeof data.order === 'number' ? data.order :
                    typeof data.sortOrder === 'number' ? data.sortOrder :
                    typeof data.sort_order === 'number' ? data.sort_order : 999;

      // Level 2 default detection
      const isDefaultL2 = Boolean(
        data.defaultLevel2 ||
        data.default_level_2 ||
        data.isDefaultLevel2 ||
        data.isDefaultL2 ||
        data.defaultForLevel2 ||
        data.level2Default ||
        data.level2_default ||
        (data.defaultLevel === 2) ||
        (data.default_level === 2) ||
        (data.level === 2 && (data.isDefault || data.default))
      );

      // Level 1 default detection
      const isDefaultL1 = Boolean(
        data.defaultLevel1 ||
        data.default_level_1 ||
        data.isDefaultLevel1 ||
        data.isDefaultL1 ||
        data.defaultForLevel1 ||
        data.level1Default ||
        data.level1_default ||
        (data.defaultLevel === 1) ||
        (data.default_level === 1) ||
        (data.level === 1 && (data.isDefault || data.default)) ||
        data.isDefault ||
        data.default
      );

      models.push({
        id: modelId,
        name,
        category: rawCategory,
        normalizedCategory: normalizedCat,
        order,
        isActive: true,
        isDefaultL2,
        isDefaultL1
      });
    });

    // Sort by order ascending
    models.sort((a, b) => a.order - b.order);

    return models;
  } catch (error) {
    console.error("Error fetching central AI models:", error);
    throw error;
  }
}
