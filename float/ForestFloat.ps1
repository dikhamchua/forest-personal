param([switch]$SelfTest)

# Widget nổi (always-on-top) cho Forest Personal.
# WPF, không viền, trong suốt, luôn nổi trên các app khác.
# Giao tiếp với extension qua bridge HTTP trong server.ps1 (file trong %TEMP%\forest-float).

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Net.Http

# Windows PowerShell 5.1 mặc định không bật TLS 1.2 → ảnh cây (https) sẽ tải lỗi.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$dir = Join-Path $env:TEMP "forest-float"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$stateFile = Join-Path $dir "state.json"
$cmdFile = Join-Path $dir "cmd.json"

$script:duration = 25

$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Forest Float" Width="304" Height="404" WindowStyle="None"
        AllowsTransparency="True" Background="Transparent" ResizeMode="NoResize"
        ShowInTaskbar="True" Topmost="True" ShowActivated="False"
        WindowStartupLocation="CenterScreen">
  <Border x:Name="Root" Margin="6" CornerRadius="18">
    <Border.Background>
      <LinearGradientBrush StartPoint="0,0" EndPoint="1,1">
        <GradientStop Color="#5AA87D" Offset="0"/>
        <GradientStop Color="#2F7D57" Offset="1"/>
      </LinearGradientBrush>
    </Border.Background>
    <Border.Effect>
      <DropShadowEffect BlurRadius="18" ShadowDepth="0" Opacity="0.35"/>
    </Border.Effect>

    <Grid Margin="14,12,14,12">
      <Grid.RowDefinitions>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="*"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
      </Grid.RowDefinitions>

      <Grid Grid.Row="0">
        <Button x:Name="OptBtn" Content="&#x2699;" Width="30" Height="30"
                HorizontalAlignment="Left" FontSize="15" Foreground="White"
                Background="#22FFFFFF" BorderThickness="0" Cursor="Hand" ToolTip="Settings"/>
        <Button x:Name="CloseBtn" Content="&#x2715;" Width="30" Height="30"
                HorizontalAlignment="Right" FontSize="13" Foreground="White"
                Background="#22FFFFFF" BorderThickness="0" Cursor="Hand" ToolTip="Close"/>
      </Grid>

      <TextBlock x:Name="Msg" Grid.Row="1" AutomationProperties.AutomationId="Msg" Margin="2,10,2,6" TextWrapping="Wrap"
                 TextAlignment="Center" FontSize="13" Foreground="#F2FFFFFF"
                 Text="Click the tree to start planting!"/>

      <Grid Grid.Row="2" VerticalAlignment="Center" HorizontalAlignment="Center">
        <Ellipse Width="132" Height="132">
          <Ellipse.Fill>
            <RadialGradientBrush GradientOrigin="0.5,0.35" Center="0.5,0.4" RadiusX="0.7" RadiusY="0.7">
              <GradientStop Color="#FBF2BD" Offset="0"/>
              <GradientStop Color="#EFE39A" Offset="1"/>
            </RadialGradientBrush>
          </Ellipse.Fill>
        </Ellipse>
        <Image x:Name="TreeImg" Width="108" Height="108" Stretch="Uniform"
               Visibility="Collapsed" HorizontalAlignment="Center" VerticalAlignment="Center"/>
        <TextBlock x:Name="Tree" Text="&#x1F333;" FontSize="70"
                   HorizontalAlignment="Center" VerticalAlignment="Center"/>
      </Grid>

      <TextBlock x:Name="Timer" Grid.Row="3" Text="25:00" FontSize="44" FontWeight="Bold"
                 AutomationProperties.AutomationId="Timer"
                 Foreground="White" TextAlignment="Center" Margin="0,4,0,6"/>

      <StackPanel x:Name="Chips" Grid.Row="4" Orientation="Horizontal"
                  HorizontalAlignment="Center" Margin="0,0,0,8">
        <Button x:Name="Chip10" Content="10" Width="33" Height="24" Margin="3,0"
                FontSize="11" Foreground="White" BorderBrush="#88FFFFFF"
                Background="Transparent" Tag="10" Cursor="Hand"/>
        <Button x:Name="Chip15" Content="15" Width="33" Height="24" Margin="3,0"
                FontSize="11" Foreground="White" BorderBrush="#88FFFFFF"
                Background="Transparent" Tag="15" Cursor="Hand"/>
        <Button x:Name="Chip25" Content="25" Width="33" Height="24" Margin="2,0"
                FontSize="11" Foreground="White" BorderBrush="#88FFFFFF"
                Background="Transparent" Tag="25" Cursor="Hand"/>
        <Button x:Name="Chip30" Content="30" Width="33" Height="24" Margin="2,0"
                FontSize="11" Foreground="White" BorderBrush="#88FFFFFF"
                Background="Transparent" Tag="30" Cursor="Hand"/>
        <Button x:Name="Chip35" Content="35" Width="33" Height="24" Margin="2,0"
                FontSize="11" Foreground="White" BorderBrush="#88FFFFFF"
                Background="Transparent" Tag="35" Cursor="Hand"/>
        <Button x:Name="Chip45" Content="45" Width="33" Height="24" Margin="3,0"
                FontSize="11" Foreground="White" BorderBrush="#88FFFFFF"
                Background="Transparent" Tag="45" Cursor="Hand"/>
        <Button x:Name="Chip60" Content="60" Width="33" Height="24" Margin="3,0"
                FontSize="11" Foreground="White" BorderBrush="#88FFFFFF"
                Background="Transparent" Tag="60" Cursor="Hand"/>
      </StackPanel>

      <Grid Grid.Row="5">
        <Button x:Name="StartBtn" Content="Start 25m" Height="34" Width="150"
                HorizontalAlignment="Left" Background="White" Foreground="#2F7D57"
                BorderThickness="0" FontWeight="SemiBold" Cursor="Hand"/>
        <Button x:Name="GiveBtn" Content="Give up" Height="34" Width="150"
                HorizontalAlignment="Left" Background="#33000000" Foreground="White"
                BorderBrush="#88FFFFFF" BorderThickness="1" Cursor="Hand"
                Visibility="Collapsed"/>
        <TextBlock x:Name="Coin" Text="" Foreground="#E6FFFFFF" FontSize="12"
                   VerticalAlignment="Center" HorizontalAlignment="Right"/>
      </Grid>
    </Grid>
  </Border>
</Window>
'@

$win = [Windows.Markup.XamlReader]::Parse($xaml)
$root = $win.FindName("Root")
$msg = $win.FindName("Msg")
$timer = $win.FindName("Timer")
$tree = $win.FindName("Tree")
$startBtn = $win.FindName("StartBtn")
$giveBtn = $win.FindName("GiveBtn")
$coin = $win.FindName("Coin")
$optBtn = $win.FindName("OptBtn")
$closeBtn = $win.FindName("CloseBtn")
$treeImg = $win.FindName("TreeImg")

$chips = @()
foreach ($n in @("Chip10", "Chip15", "Chip25", "Chip30", "Chip35", "Chip45", "Chip60")) {
    $chips += $win.FindName($n)
}

function Write-Cmd($obj) {
    $json = $obj | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($cmdFile, $json)
}

function Select-Duration([int]$d) {
    $script:duration = $d
    foreach ($c in $chips) {
        if ([int]$c.Tag -eq $d) {
            $c.Background = [Windows.Media.Brushes]::White
            $c.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString("#2F7D57")
            $c.BorderBrush = [Windows.Media.Brushes]::White
            $c.FontWeight = "SemiBold"
        } else {
            $c.Background = [Windows.Media.Brushes]::Transparent
            $c.Foreground = [Windows.Media.Brushes]::White
            $c.BorderBrush = [Windows.Media.BrushConverter]::new().ConvertFromString("#88FFFFFF")
            $c.FontWeight = "Normal"
        }
    }
    if ($startBtn.Visibility -eq "Visible") { $startBtn.Content = "Start ${d}m" }
}

foreach ($c in $chips) {
    $c.Add_Click({
        param($s, $e)
        Select-Duration ([int]$s.Tag)
    })
}

$win.Add_MouseLeftButtonDown({
    param($s, $e)
    if ($e.OriginalSource -is [System.Windows.Controls.Button]) { return }
    $win.DragMove()
})

$closeBtn.Add_Click({ $win.Close() })
$optBtn.Add_Click({ Write-Cmd @{ cmd = "open-options" } })

$startBtn.Add_Click({
    Write-Cmd @{ cmd = "start"; duration = $script:duration }
})
$giveBtn.Add_Click({ Write-Cmd @{ cmd = "giveup" } })

$script:lastPhase = ""
$script:imgTried = @{}
$script:curImgUrl = $null
$script:curImgOk = $false

function Load-TreeImage([string]$url) {
    $script:curImgUrl = $url
    $script:curImgOk = $false
    if ($script:imgTried.ContainsKey($url)) { $script:curImgOk = $script:imgTried[$url]; return }
    try {
        $client = New-Object System.Net.Http.HttpClient
        $client.Timeout = [TimeSpan]::FromSeconds(3)
        [void]$client.DefaultRequestHeaders.TryAddWithoutValidation("user-agent", "ForestFloat/1.0")
        $bytes = $client.GetByteArrayAsync($url).GetAwaiter().GetResult()
        $ms = New-Object IO.MemoryStream(, $bytes)
        $bmp = New-Object Windows.Media.Imaging.BitmapImage
        $bmp.BeginInit()
        $bmp.StreamSource = $ms
        $bmp.CacheOption = [Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        $bmp.EndInit()
        $bmp.Freeze()
        $treeImg.Source = $bmp
        $script:curImgOk = $true
    } catch {
        $script:curImgOk = $false
    } finally {
        $script:imgTried[$url] = $script:curImgOk
    }
}

function Update-Ui {
    if (-not (Test-Path $stateFile)) { return }
    try { $s = Get-Content -Raw -Path $stateFile | ConvertFrom-Json } catch { return }

    $planting = $s.planting
    $loggedIn = ($s.loggedIn -eq $true)

    if (-not $loggedIn) {
        $treeImg.Visibility = "Collapsed"; $tree.Visibility = "Visible"
        $msg.Text = "Open settings to sign in"
        $timer.Text = "00:00"
        $tree.Text = [char]::ConvertFromUtf32(0x1F333)
        $startBtn.Visibility = "Collapsed"
        $giveBtn.Visibility = "Collapsed"
        foreach ($c in $chips) { $c.Visibility = "Collapsed" }
    } elseif ($null -ne $planting) {
        $end = [datetime]::Parse($planting.endTime).ToUniversalTime()
        $secs = [int][math]::Max(0, ($end - [datetime]::UtcNow).TotalSeconds)
        $timer.Text = "{0}:{1:00}" -f [math]::Floor($secs / 60), ($secs % 60)
        $total = [double]$planting.durationMin * 60
        $ratio = 1 - ($secs / [math]::Max(1, $total))
        $icon = 0x1F331; $label = "Seedling"
        if ($ratio -ge 0.9) { $icon = 0x1F333; $label = "Almost grown" }
        elseif ($ratio -ge 2 / 3) { $icon = 0x1FAB4; $label = "Young tree" }
        elseif ($ratio -ge 1 / 3) { $icon = 0x1F33F; $label = "Sprouting" }
        if ($script:lastPhase -ne $label) {
            $tree.Text = [char]::ConvertFromUtf32($icon)
            $script:lastPhase = $label
        }
        if ($planting.treeImage) {
            if ($planting.treeImage -ne $script:curImgUrl) { Load-TreeImage $planting.treeImage }
            if ($script:curImgOk) {
                $treeImg.Visibility = "Visible"; $tree.Visibility = "Collapsed"
            } else {
                $treeImg.Visibility = "Collapsed"; $tree.Visibility = "Visible"
            }
        } else {
            $treeImg.Visibility = "Collapsed"; $tree.Visibility = "Visible"
        }
        $parts = @($label)
        if ($planting.treeTitle) { $parts += $planting.treeTitle }
        elseif ($planting.tagTitle) { $parts += $planting.tagTitle }
        $msg.Text = ($parts -join " - ")
        $startBtn.Visibility = "Collapsed"
        $giveBtn.Visibility = "Visible"
        foreach ($c in $chips) { $c.Visibility = "Collapsed" }
    } else {
        $msg.Text = "Click the tree to start planting!"
        $treeImg.Visibility = "Collapsed"; $tree.Visibility = "Visible"
        $script:curImgUrl = $null
        $tree.Text = [char]::ConvertFromUtf32(0x1F333)
        $script:lastPhase = ""
$script:imgTried = @{}
$script:curImgUrl = $null
$script:curImgOk = $false

function Load-TreeImage([string]$url) {
    $script:curImgUrl = $url
    $script:curImgOk = $false
    if ($script:imgTried.ContainsKey($url)) { $script:curImgOk = $script:imgTried[$url]; return }
    try {
        $client = New-Object System.Net.Http.HttpClient
        $client.Timeout = [TimeSpan]::FromSeconds(3)
        [void]$client.DefaultRequestHeaders.TryAddWithoutValidation("user-agent", "ForestFloat/1.0")
        $bytes = $client.GetByteArrayAsync($url).GetAwaiter().GetResult()
        $ms = New-Object IO.MemoryStream(, $bytes)
        $bmp = New-Object Windows.Media.Imaging.BitmapImage
        $bmp.BeginInit()
        $bmp.StreamSource = $ms
        $bmp.CacheOption = [Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        $bmp.EndInit()
        $bmp.Freeze()
        $treeImg.Source = $bmp
        $script:curImgOk = $true
    } catch {
        $script:curImgOk = $false
    } finally {
        $script:imgTried[$url] = $script:curImgOk
    }
}
        $timer.Text = ("{0:00}:00" -f $script:duration)
        $startBtn.Visibility = "Visible"
        $giveBtn.Visibility = "Collapsed"
        $startBtn.Content = "Start $($script:duration)m"
        foreach ($c in $chips) { $c.Visibility = "Visible" }
    }

    $coin.Text = if ($loggedIn) { "$($s.coin) coins" } else { "" }
}

$timerUi = New-Object Windows.Threading.DispatcherTimer
$timerUi.Interval = [TimeSpan]::FromMilliseconds(500)
$timerUi.Add_Tick({ Update-Ui })
$timerUi.Start()

Select-Duration 25
Update-Ui

if ($SelfTest) {
    # Kiểm thử tự động: hiện cửa sổ, in HWND rồi chạy bình thường (test sẽ kill).
    $win.Show()
    $handle = (New-Object Windows.Interop.WindowInteropHelper($win)).Handle
    Write-Output ("HWND=" + $handle)
    [void][Windows.Threading.Dispatcher]::Run()
} else {
    [void]$win.ShowDialog()
}
