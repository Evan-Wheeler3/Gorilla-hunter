using System.Collections.Generic;
using UnityEngine;

namespace PrimalRaid.World
{
    /// <summary>Flat-colour materials and primitive helpers for greybox geometry.</summary>
    public static class GreyboxMaterials
    {
        static readonly Dictionary<Color, Material> cache = new Dictionary<Color, Material>();
        static Shader shader;

        public static Material Get(Color color)
        {
            if (cache.TryGetValue(color, out var material) && material != null)
                return material;

            if (shader == null)
                shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");

            material = new Material(shader) { color = color };
            if (material.HasProperty("_Glossiness"))
                material.SetFloat("_Glossiness", 0.05f);
            if (material.HasProperty("_Smoothness"))
                material.SetFloat("_Smoothness", 0.05f);
            cache[color] = material;
            return material;
        }

        /// <summary>Creates a coloured box. Pass collider = false for visual-only parts.</summary>
        public static GameObject Box(string name, Transform parent, Vector3 localPosition, Vector3 size,
                                     Color color, bool collider = true)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPosition;
            go.transform.localScale = size;
            go.GetComponent<Renderer>().sharedMaterial = Get(color);
            if (!collider)
                Object.DestroyImmediate(go.GetComponent<Collider>());
            return go;
        }
    }
}
