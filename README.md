## Demo版本的Browserless
> 在云函数部署你的无头浏览器，然后在另外的地方看到并操作它（脱了裤子放屁），但是能和 manus 扯上关系，可能后面会搞一个类 manus的项目（鸽子预警）

![demo](https://raw.githubusercontent.com/LiuTianjie/browser-less-test/main/static/demo.gif)

由于现在云函数不允许直接访问 html 了， 所以这里面的 index.html 还需要单独部署到另外一个地方，替换里面的 wss 地址为你部署的地址

## How to run
以腾讯云云函数为例， fork 本仓库之后，首先创建一个云函数，依次为

1. 创建函数：选择"使用容器镜像"

![创建函数](https://raw.githubusercontent.com/LiuTianjie/browser-less-test/main/static/1.png)

2. 选择新建容器镜像

![新建容器镜像](https://raw.githubusercontent.com/LiuTianjie/browser-less-test/main/static/2.png)

3. 创建构建流水线（不用说都会了吧）

![新建容器镜像](https://raw.githubusercontent.com/LiuTianjie/browser-less-test/main/static/3.png)

4. 回到函数创建，选择刚才流水线构建出来的镜像，然后记得在打开公网访问，并在高级设置里面打开 websocket 选项。本容器里面会
包含一个 chromium ，所以内存最好设大点，实测 300M 应该够了。

5. 函数跑起来之后，看看 url，把 index.html 里面的地址替换掉，html文件本身可以放在任何静态资源托管的地方。本地可以 vs 装个 liveserver 看效果，也可以随便找个存储桶，开个静态网站就行。

## TODO： Nick Manus
先上个架构图，理论上我们可以借助这套东西构建自己的 manus, 时间有限，就晚些填坑吧。

![新建容器镜像](https://raw.githubusercontent.com/LiuTianjie/browser-less-test/main/static/structure.jpg)
