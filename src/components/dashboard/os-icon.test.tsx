// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { OsIcon } from './os-icon'

describe('OsIcon 云厂商及操作系统识别测试', () => {
  it('识别 Alibaba Cloud Linux / 阿里云 (osType=alinux)', () => {
    const { container } = render(<OsIcon osType="alinux" />)
    const rect = container.querySelector('rect')
    expect(rect).toBeInTheDocument()
    expect(rect?.getAttribute('fill')).toBe('#FF6A00')
  })

  it('识别 Alibaba Cloud Linux / 阿里云 (osType=aliyun)', () => {
    const { container } = render(<OsIcon osType="aliyun" />)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#FF6A00')
  })

  it('当 osType 为空但 osInfo 包含 Alibaba Cloud Linux 时正确识别为阿里云', () => {
    const { container } = render(
      <OsIcon osInfo="Alibaba Cloud Linux 3.2104 LTS 64位 等保2.0三级版 | x86_64 | 5.10.134" />
    )
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#FF6A00')
  })

  it('识别 TencentOS / 腾讯云 (osType=tencentos)', () => {
    const { container } = render(<OsIcon osType="tencentos" />)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#0052D9')
  })

  it('识别 Huawei Cloud EulerOS / 华为云 (osType=euleros)', () => {
    const { container } = render(<OsIcon osType="euleros" />)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#C7000B')
  })

  it('识别 Huawei Cloud EulerOS / HCE (osType=hce)', () => {
    const { container } = render(<OsIcon osType="hce" />)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#C7000B')
  })

  it('识别 openEuler (osType=openeuler)', () => {
    const { container } = render(<OsIcon osType="openeuler" />)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#002FA7')
  })

  it('识别 Amazon Linux / AWS (osType=amzn)', () => {
    const { container } = render(<OsIcon osType="amzn" />)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#232F3E')
    expect(container.textContent).toContain('aws')
  })

  it('识别 Google Cloud / COS (osType=cos)', () => {
    const { container } = render(<OsIcon osType="cos" />)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#1A73E8')
  })

  it('识别 Azure Linux / Mariner (osType=azurelinux)', () => {
    const { container } = render(<OsIcon osType="azurelinux" />)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#0078D4')
  })

  it('识别 龙蜥 Anolis OS (osType=anolis)', () => {
    const { container } = render(<OsIcon osType="anolis" />)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#0078FE')
  })

  it('识别 银河麒麟 Kylin (osType=kylin)', () => {
    const { container } = render(<OsIcon osType="kylin" />)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#D32F2F')
  })

  it('识别 统信 UOS (osType=uos)', () => {
    const { container } = render(<OsIcon osType="uos" />)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#0081FF')
  })

  it('识别 Ubuntu (osType=ubuntu)', () => {
    const { container } = render(<OsIcon osType="ubuntu" />)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#E95420')
  })

  it('识别 CentOS (osType=centos)', () => {
    const { container } = render(<OsIcon osType="centos" />)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#2E3036')
  })

  it('未识别时回退为通用 Linux 企鹅图标', () => {
    const { container } = render(<OsIcon osType="unknown-distro" />)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#334155')
  })
})
