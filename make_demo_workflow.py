#!/usr/bin/env python3
"""生成 FlowLinks 演示工作流（界面格式，纯公开模型，无个人角色引用）。
SDXL 标准文生图：RealVisXL V5.0 + skin texture style v4 LoRA（公开通用 LoRA）。
"""
import json

POS = ("A futuristic cyberpunk city street at night in the rain, towering neon-lit "
       "skyscrapers with glowing cyan and magenta holographic signs, wet reflective "
       "pavement, a sleek flying vehicle passing overhead, volumetric fog, cinematic "
       "composition, ultra-detailed, photorealistic, 8k.")
NEG = ("blurry, low quality, deformed, watermark, logo, text, people, person, "
       "cartoon, anime, illustration, CGI, 3d render, sketch, painterly")


def node(id_, type_, pos, size, widgets, inputs, outputs, title=None):
    n = {
        "id": id_, "type": type_, "pos": pos, "size": size,
        "flags": {}, "order": id_ - 1, "mode": 0,
        "inputs": inputs, "outputs": outputs,
        "properties": {"Node name for S&R": type_},
        "widgets_values": widgets,
    }
    if title:
        n["title"] = title
    return n


def inp(name, type_, link=None):
    d = {"name": name, "type": type_}
    if link is not None:
        d["link"] = link
    return d


def outp(name, type_, links):
    return {"name": name, "type": type_, "links": links, "slot_index": 0}


nodes = [
    node(1, "CheckpointLoaderSimple", [40, 60], [340, 98],
         ["RealVisXL_V5.0_fp16.safetensors"],
         [],
         [outp("MODEL", "MODEL", [1]), outp("CLIP", "CLIP", [2]), outp("VAE", "VAE", [10])]),
    node(2, "LoraLoader", [40, 360], [340, 130],
         ["skin_texture_style_v4_lora_f16.ckpt", 0.4, 0.4],
         [inp("model", "MODEL", 1), inp("clip", "CLIP", 2)],
         [outp("MODEL", "MODEL", [5]), outp("CLIP", "CLIP", [3, 4])]),
    node(3, "CLIPTextEncode", [580, 20], [430, 210],
         [POS],
         [inp("clip", "CLIP", 3)],
         [outp("CONDITIONING", "CONDITIONING", [6])], title="CLIP Text Encode (Positive)"),
    node(4, "CLIPTextEncode", [580, 400], [430, 150],
         [NEG],
         [inp("clip", "CLIP", 4)],
         [outp("CONDITIONING", "CONDITIONING", [7])], title="CLIP Text Encode (Negative)"),
    node(5, "EmptyLatentImage", [580, 700], [315, 106],
         [768, 1024, 1],
         [],
         [outp("LATENT", "LATENT", [8])]),
    node(6, "KSampler", [1220, 260], [315, 262],
         [42, "fixed", 30, 7.0, "dpmpp_2m", "karras", 1.0],
         [inp("model", "MODEL", 5), inp("positive", "CONDITIONING", 6),
          inp("negative", "CONDITIONING", 7), inp("latent_image", "LATENT", 8)],
         [outp("LATENT", "LATENT", [9])]),
    node(7, "VAEDecode", [1220, 640], [210, 46],
         [],
         [inp("samples", "LATENT", 9), inp("vae", "VAE", 10)],
         [outp("IMAGE", "IMAGE", [11])]),
    node(8, "SaveImage", [1620, 420], [315, 270],
         ["flowlinks-demo-cyberpunk"],
         [inp("images", "IMAGE", 11)],
         []),
]

links = [
    [1, 1, 0, 2, 0, "MODEL"],
    [2, 1, 1, 2, 1, "CLIP"],
    [3, 2, 1, 3, 0, "CLIP"],
    [4, 2, 1, 4, 0, "CLIP"],
    [5, 2, 0, 6, 0, "MODEL"],
    [6, 3, 0, 6, 1, "CONDITIONING"],
    [7, 4, 0, 6, 2, "CONDITIONING"],
    [8, 5, 0, 6, 3, "LATENT"],
    [9, 6, 0, 7, 0, "LATENT"],
    [10, 1, 2, 7, 1, "VAE"],
    [11, 7, 0, 8, 0, "IMAGE"],
]

wf = {
    "id": "flowlinks-demo-cyberpunk",
    "revision": 0,
    "last_node_id": 8,
    "last_link_id": 11,
    "nodes": nodes,
    "links": links,
    "groups": [],
    "config": {},
    "extra": {"ds": {"scale": 0.9, "offset": [0, 0]}},
    "version": 0.4,
}

out = "/home/hatch/workspace/flow-links/flowlinks-demo-cyberpunk.json"
with open(out, "w") as f:
    json.dump(wf, f, indent=1, ensure_ascii=False)
print("wrote", out)
