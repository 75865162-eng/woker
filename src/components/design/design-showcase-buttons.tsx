"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section, SectionBody } from "@/components/ui/section";
import { Block } from "./design-showcase-model";
export function ButtonsShowcase() { return (<Block title="5 · 按钮与七态" note="Default / Hover / Focus / Active / Disabled / Loading / Error">
        <Section>
          <SectionBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button>主操作</Button>
              <Button variant="secondary">次要操作</Button>
              <Button variant="ghost">文字按钮</Button>
              <Button variant="danger">危险操作</Button>
              <Button size="sm">小号</Button>
              <Button size="icon" aria-label="添加">
                <Plus aria-hidden className="h-3.5 w-3.5" />
              </Button>
              <Button disabled>禁用</Button>
              <Button disabled>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                保存中
              </Button>
            </div>
            <div className="grid gap-2 text-meta text-muted md:grid-cols-2">
              <p>悬停：主按钮加深到 brand-dark；次按钮加浅底并加深描边。</p>
              <p>聚焦：统一 2px 品牌色焦点环 + 1px 偏移；键盘可见，鼠标不显示。</p>
              <p>禁用：透明度 50% + 关闭指针事件，不改变布局占位。</p>
              <p>加载：按钮内转圈、文案改「保存中」，同时禁用避免重复提交。</p>
            </div>
          </SectionBody>
        </Section>
      </Block>); }
