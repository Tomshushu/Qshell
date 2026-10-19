import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PipelineBlocksViewer } from '../pipeline-blocks-viewer'
import type { ShellPipelineExplainResult } from '@/types/ai'

describe('PipelineBlocksViewer Component', () => {
  afterEach(cleanup)
  const mockData: ShellPipelineExplainResult = {
    fullCommand: "cat access.log | awk '{print $1}' | sort | uniq -c",
    summary: '提取关键字段并按出现频次降序统计 TOP 结果。',
    isPipeline: true,
    hasDestructiveRisk: false,
    steps: [
      {
        stepIndex: 1,
        rawCommand: 'cat access.log',
        program: 'cat',
        args: ['access.log'],
        actionDescription: '读取文件 [access.log] 的完整文本流',
        dataFlowDescription: '📥 初始输入数据流',
        riskLevel: 'safe',
      },
      {
        stepIndex: 2,
        rawCommand: "awk '{print $1}'",
        program: 'awk',
        args: ["'{print $1}'"],
        actionDescription: '提取每行第 1 个字段 (如 IP 地址或首列标识)',
        flagsExplanation: [{ flag: 'print $1', meaning: '输出第 1 列字段' }],
        dataFlowDescription: '🔄 管道中间过渡数据流 (Step 1 ➔ Step 2)',
        riskLevel: 'safe',
      },
      {
        stepIndex: 3,
        rawCommand: 'sort',
        program: 'sort',
        args: [],
        actionDescription: '将文本按行进行字典序升序排序',
        dataFlowDescription: '🔄 管道中间过渡数据流 (Step 2 ➔ Step 3)',
        riskLevel: 'safe',
      },
      {
        stepIndex: 4,
        rawCommand: 'uniq -c',
        program: 'uniq',
        args: ['-c'],
        actionDescription: '统计每个相邻重复行出现的频次并输出前缀计数值',
        flagsExplanation: [{ flag: '-c', meaning: '计数统计 (Count)' }],
        dataFlowDescription: '🎯 最终格式化结果输出',
        riskLevel: 'safe',
      },
    ],
  }

  it('renders pipeline summary, step count, and safety banner', () => {
    render(<PipelineBlocksViewer data={mockData} />)

    expect(screen.getByText('指令乐高积木式拆解')).toBeDefined()
    expect(screen.getByText('4 个流转步骤')).toBeDefined()
    expect(screen.getByText(/提取关键字段并按出现频次降序统计/)).toBeDefined()
    expect(screen.getByText(/纯只读数据流处理/)).toBeDefined()
  })

  it('renders each lego step block with correct badges and actions', () => {
    render(<PipelineBlocksViewer data={mockData} />)

    expect(screen.getByTestId('lego-step-1')).toBeDefined()
    expect(screen.getByTestId('lego-step-2')).toBeDefined()
    expect(screen.getByTestId('lego-step-3')).toBeDefined()
    expect(screen.getByTestId('lego-step-4')).toBeDefined()

    expect(screen.getByText('STEP 01')).toBeDefined()
    expect(screen.getByText('STEP 02')).toBeDefined()
    expect(screen.getByText(/提取每行第 1 个字段/)).toBeDefined()
    expect(screen.getByText('print $1')).toBeDefined()
    expect(screen.getByText('输出第 1 列字段')).toBeDefined()
  })

  it('displays destructive warning when command has risk', () => {
    const dangerousData: ShellPipelineExplainResult = {
      ...mockData,
      hasDestructiveRisk: true,
      steps: [
        {
          ...mockData.steps[0],
          riskLevel: 'dangerous',
          riskReason: '包含直接删除或修改操作',
        },
      ],
    }
    render(<PipelineBlocksViewer data={dangerousData} />)
    expect(screen.getByText(/警告：该指令包含写操作\/修改\/删除行为/)).toBeDefined()
    expect(screen.getByText('包含直接删除或修改操作')).toBeDefined()
  })

  it('supports terminal injection button callback', () => {
    const onCopyToTerminal = vi.fn()
    render(<PipelineBlocksViewer data={mockData} onCopyToTerminal={onCopyToTerminal} />)

    const injectBtn = screen.getByText('输入至当前终端')
    fireEvent.click(injectBtn)
    expect(onCopyToTerminal).toHaveBeenCalledWith(mockData.fullCommand)
  })
})
